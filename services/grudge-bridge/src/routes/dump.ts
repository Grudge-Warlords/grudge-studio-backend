import { Router, type Request, type Response } from "express";
import { createGzip } from "zlib";
import type { BridgeConfig } from "../bridge.config";
import { mysqlDump, mysqlExec } from "../lib/exec";
import { sha256Buffer, buildManifest } from "../lib/sha";
import { uploadBackup } from "../lib/r2";
import { relayToPrimary } from "../lib/peers";

export function dumpRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * POST /api/bridge/dump
   * Body: { type?: "daily" | "weekly" }
   *
   * On primary: runs mysqldump locally via Docker exec.
   * On replica: relays to the primary node via Radmin mesh.
   */
  router.post("/dump", async (req: Request, res: Response) => {
    const type = (req.body?.type as string) || "daily";

    // Replicas relay to primary
    if (config.nodeRole !== "primary") {
      const relayed = await relayToPrimary(
        config,
        "/api/bridge/dump",
        "POST",
        { type }
      );
      if (relayed) {
        return res.status(relayed.status).json(relayed.data);
      }
      return res.status(502).json({
        error: "Cannot reach primary node",
        hint: "Ensure the Linux VPS bridge is running and Radmin mesh is connected",
      });
    }

    // Primary — execute the dump
    const start = Date.now();
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-T]/g, "")
      .slice(0, 14);
    const fileName = `grudge-mysql-${timestamp}.sql.gz`;

    try {
      // 1. Run mysqldump
      console.log(`▶ Starting MySQL dump (${type})...`);
      const dumpResult = await mysqlDump(config.nodeRole, {
        container: config.mysql.container,
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
      });

      if (dumpResult.exitCode !== 0) {
        return res.status(500).json({
          error: "mysqldump failed",
          stderr: dumpResult.stderr.slice(0, 500),
          exitCode: dumpResult.exitCode,
        });
      }

      // 2. Gzip the output
      const sqlBuffer = Buffer.from(dumpResult.stdout, "utf-8");
      const gzipped = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const gzip = createGzip({ level: 6 });
        gzip.on("data", (chunk) => chunks.push(chunk));
        gzip.on("end", () => resolve(Buffer.concat(chunks)));
        gzip.on("error", reject);
        gzip.end(sqlBuffer);
      });

      // 3. Compute SHA-256
      const hash = sha256Buffer(gzipped);

      // 4. Upload to R2
      const r2Key = `${config.r2.backupPrefix}/${type}/${fileName}`;
      console.log(`  Uploading ${r2Key} (${(gzipped.length / 1024 / 1024).toFixed(1)} MB)...`);
      await uploadBackup(config, r2Key, gzipped, {
        sha256: hash,
        node: config.nodeName,
      });

      // 5. Get table count for manifest
      let tableCount = 0;
      try {
        const countResult = await mysqlExec(
          config.nodeRole,
          `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${config.mysql.database}'`,
          {
            container: config.mysql.container,
            host: config.mysql.host,
            port: config.mysql.port,
            user: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
          }
        );
        tableCount = parseInt(countResult.stdout.trim(), 10) || 0;
      } catch {}

      // 6. Write SHA manifest to R2
      const duration = Date.now() - start;
      const manifest = buildManifest(
        fileName,
        hash,
        gzipped.length,
        tableCount,
        config.nodeName,
        duration
      );

      const manifestKey = `${config.r2.backupPrefix}/manifests/${timestamp}.json`;
      await uploadBackup(
        config,
        manifestKey,
        Buffer.from(JSON.stringify(manifest, null, 2))
      );

      console.log(`  ✅ Dump complete: ${fileName} (SHA: ${hash.slice(0, 12)}...)`);

      res.json({
        file: fileName,
        sha256: hash,
        size: gzipped.length,
        r2Path: r2Key,
        manifestPath: manifestKey,
        tables: tableCount,
        duration,
      });
    } catch (err: any) {
      console.error("Dump failed:", err.message);
      res.status(500).json({ error: "Dump failed", detail: err.message });
    }
  });

  return router;
}
