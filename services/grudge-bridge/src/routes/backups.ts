import { Router, type Request, type Response } from "express";
import type { BridgeConfig } from "../bridge.config";
import { listBackups, downloadBackup, getManifest, deleteBackup } from "../lib/r2";
import { sha256Buffer } from "../lib/sha";

export function backupsRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * GET /api/bridge/backups
   * Query: ?type=daily|weekly
   *
   * Lists all backups in R2 with sizes, dates, and SHA manifest data.
   */
  router.get("/backups", async (req: Request, res: Response) => {
    const type = req.query.type as "daily" | "weekly" | undefined;

    try {
      const entries = await listBackups(config, type);

      // Filter out manifests from the main listing
      const backups = entries.filter((e) => e.type !== "manifest");
      const manifests = entries.filter((e) => e.type === "manifest");

      // Enrich backups with manifest data
      const enriched = await Promise.all(
        backups.map(async (entry) => {
          // Try to find matching manifest
          const timestamp = entry.file
            .replace("grudge-mysql-", "")
            .replace(".sql.gz", "");
          const manifest = await getManifest(config, timestamp);

          return {
            ...entry,
            lastModified: entry.lastModified.toISOString(),
            sizeHuman: formatBytes(entry.size),
            sha256: (manifest?.sha256 as string) || null,
            tables: (manifest?.tables as number) || null,
            node: (manifest?.node as string) || null,
            duration: (manifest?.duration as number) || null,
          };
        })
      );

      res.json({
        count: enriched.length,
        backups: enriched,
        manifests: manifests.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list backups", detail: err.message });
    }
  });

  /**
   * GET /api/bridge/backups/:file/verify
   * Re-downloads the backup and re-hashes to confirm R2 integrity.
   */
  router.get("/backups/:file/verify", async (req: Request, res: Response) => {
    const { file } = req.params;
    const type = (req.query.type as string) || "daily";
    const r2Key = `${config.r2.backupPrefix}/${type}/${file}`;

    try {
      // Download and hash
      const { stream, size } = await downloadBackup(config, r2Key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);
      const actualHash = sha256Buffer(data);

      // Compare with manifest
      const timestamp = file.replace("grudge-mysql-", "").replace(".sql.gz", "");
      const manifest = await getManifest(config, timestamp);

      const matches = manifest ? manifest.sha256 === actualHash : null;

      res.json({
        file,
        r2Key,
        size: data.length,
        sizeHuman: formatBytes(data.length),
        sha256: actualHash,
        manifestSha256: (manifest?.sha256 as string) || null,
        integrityVerified: matches,
        verifiedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: "Verification failed", detail: err.message });
    }
  });

  /**
   * DELETE /api/bridge/backups/:file
   * Deletes a specific backup and its manifest from R2.
   */
  router.delete("/backups/:file", async (req: Request, res: Response) => {
    const { file } = req.params;
    const type = (req.query.type as string) || "daily";
    const r2Key = `${config.r2.backupPrefix}/${type}/${file}`;
    const timestamp = file.replace("grudge-mysql-", "").replace(".sql.gz", "");
    const manifestKey = `${config.r2.backupPrefix}/manifests/${timestamp}.json`;

    try {
      await deleteBackup(config, r2Key);
      await deleteBackup(config, manifestKey).catch(() => {});
      res.json({ deleted: file, r2Key, manifestKey });
    } catch (err: any) {
      res.status(500).json({ error: "Delete failed", detail: err.message });
    }
  });

  return router;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
