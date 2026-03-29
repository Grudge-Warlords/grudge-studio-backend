import { Router, type Request, type Response } from "express";
import { createGunzip } from "zlib";
import type { BridgeConfig } from "../bridge.config";
import { downloadBackup, getManifest } from "../lib/r2";
import { sha256Buffer } from "../lib/sha";
import { mysqlExec } from "../lib/exec";
import { relayToPrimary } from "../lib/peers";

export function restoreRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * POST /api/bridge/restore
   * Body: { file: "grudge-mysql-20260325.sql.gz", type?: "daily"|"weekly", confirm: "RESTORE" }
   *
   * Safety: requires { confirm: "RESTORE" } in body to prevent accidental invocation.
   */
  router.post("/restore", async (req: Request, res: Response) => {
    const { file, type = "daily", confirm } = req.body || {};

    if (confirm !== "RESTORE") {
      return res.status(400).json({
        error: "Safety guard: include { confirm: \"RESTORE\" } in request body",
      });
    }

    if (!file) {
      return res.status(400).json({ error: "Missing 'file' in request body" });
    }

    // Replicas relay to primary
    if (config.nodeRole !== "primary") {
      const relayed = await relayToPrimary(
        config,
        "/api/bridge/restore",
        "POST",
        { file, type, confirm }
      );
      if (relayed) {
        return res.status(relayed.status).json(relayed.data);
      }
      return res.status(502).json({ error: "Cannot reach primary node" });
    }

    const r2Key = `${config.r2.backupPrefix}/${type}/${file}`;

    try {
      // 1. Download backup from R2
      console.log(`▶ Downloading ${r2Key}...`);
      const { stream, size } = await downloadBackup(config, r2Key);

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const gzipped = Buffer.concat(chunks);
      console.log(`  Downloaded: ${(gzipped.length / 1024 / 1024).toFixed(1)} MB`);

      // 2. Verify SHA-256 against manifest
      const hash = sha256Buffer(gzipped);
      const timestamp = file.replace("grudge-mysql-", "").replace(".sql.gz", "");
      const manifest = await getManifest(config, timestamp);

      let sha256Verified = false;
      if (manifest && manifest.sha256 === hash) {
        sha256Verified = true;
        console.log(`  ✅ SHA-256 verified: ${hash.slice(0, 12)}...`);
      } else if (manifest) {
        console.warn(`  ⚠️  SHA mismatch! Expected ${manifest.sha256}, got ${hash}`);
        return res.status(409).json({
          error: "SHA-256 mismatch — backup may be corrupted",
          expected: manifest.sha256,
          actual: hash,
        });
      } else {
        console.warn(`  ⚠️  No manifest found — proceeding without SHA verification`);
      }

      // 3. Decompress
      const sql = await new Promise<string>((resolve, reject) => {
        const sqlChunks: Buffer[] = [];
        const gunzip = createGunzip();
        gunzip.on("data", (chunk) => sqlChunks.push(chunk));
        gunzip.on("end", () =>
          resolve(Buffer.concat(sqlChunks).toString("utf-8"))
        );
        gunzip.on("error", reject);
        gunzip.end(gzipped);
      });

      // 4. Drop and recreate database
      console.log(`  Dropping and recreating ${config.mysql.database}...`);
      const mysqlOpts = {
        container: config.mysql.container,
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
      };

      await mysqlExec(
        config.nodeRole,
        `DROP DATABASE IF EXISTS \`${config.mysql.database}\`; CREATE DATABASE \`${config.mysql.database}\`;`,
        { ...mysqlOpts, database: "mysql" }
      );

      // 5. Import SQL (pipe via stdin not supported through exec, so write to temp + import)
      // Use docker exec with stdin pipe for the primary
      const { spawn } = await import("child_process");
      await new Promise<void>((resolve, reject) => {
        const args = config.mysql.container
          ? [
              "exec",
              "-i",
              config.mysql.container,
              "mysql",
              `-u${config.mysql.user}`,
              `-p${config.mysql.password}`,
              config.mysql.database,
            ]
          : [];
        const cmd = config.mysql.container ? "docker" : "mysql";
        const directArgs = config.mysql.container
          ? args
          : [
              `-h${config.mysql.host}`,
              `-P${config.mysql.port}`,
              `-u${config.mysql.user}`,
              `-p${config.mysql.password}`,
              config.mysql.database,
            ];

        const child = spawn(cmd, directArgs, { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin?.write(sql);
        child.stdin?.end();
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`mysql import exited with code ${code}`));
        });
        child.on("error", reject);
      });

      // 6. Verify restore
      let tableCount = 0;
      let userCount = "N/A";
      try {
        const tc = await mysqlExec(
          config.nodeRole,
          `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${config.mysql.database}'`,
          mysqlOpts
        );
        tableCount = parseInt(tc.stdout.trim(), 10) || 0;

        const uc = await mysqlExec(
          config.nodeRole,
          "SELECT COUNT(*) FROM users",
          mysqlOpts
        );
        userCount = uc.stdout.trim();
      } catch {}

      console.log(`  ✅ Restore complete — ${tableCount} tables, ${userCount} users`);

      res.json({
        restored: file,
        sha256Verified,
        sha256: hash,
        tableCount,
        userCount,
      });
    } catch (err: any) {
      console.error("Restore failed:", err.message);
      res.status(500).json({ error: "Restore failed", detail: err.message });
    }
  });

  return router;
}
