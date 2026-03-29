import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { BridgeConfig } from "../bridge.config";

/** Fields that may be exposed via GET (non-secret) */
const READABLE_FIELDS = [
  "NODE_ROLE",
  "NODE_NAME",
  "PORT",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_CONTAINER",
  "R2_BUCKET",
  "R2_BACKUP_PREFIX",
  "PEER_NODES",
  "BACKUP_DAILY_CRON",
  "BACKUP_WEEKLY_CRON",
  "BACKUP_DAILY_RETAIN",
  "BACKUP_WEEKLY_RETAIN",
  "COMPOSE_DIR",
  "CORS_ORIGINS",
];

/** Fields that may be updated via PUT */
const WRITABLE_FIELDS = new Set([
  "NODE_ROLE",
  "NODE_NAME",
  "PEER_NODES",
  "BACKUP_DAILY_CRON",
  "BACKUP_WEEKLY_CRON",
  "BACKUP_DAILY_RETAIN",
  "BACKUP_WEEKLY_RETAIN",
  "CORS_ORIGINS",
]);

/** Secret fields — never exposed, only show configured status */
const SECRET_FIELDS = [
  "BRIDGE_API_KEY",
  "MYSQL_PASSWORD",
  "R2_KEY",
  "R2_SECRET",
  "DISCORD_WEBHOOK_URL",
];

export function settingsRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * GET /api/bridge/settings
   * Returns non-secret configuration values + secret configured status.
   */
  router.get("/settings", (_req: Request, res: Response) => {
    const settings: Record<string, unknown> = {};

    for (const field of READABLE_FIELDS) {
      settings[field] = process.env[field] || null;
    }

    const secrets: Record<string, boolean> = {};
    for (const field of SECRET_FIELDS) {
      secrets[field] = !!process.env[field];
    }

    res.json({
      nodeName: config.nodeName,
      nodeRole: config.nodeRole,
      settings,
      secrets,
    });
  });

  /**
   * PUT /api/bridge/settings
   * Body: { NODE_ROLE: "replica", PEER_NODES: "..." }
   *
   * Only whitelisted fields can be updated.
   * Writes to .env.bridge in the compose directory.
   */
  router.put("/settings", (req: Request, res: Response) => {
    const updates = req.body || {};
    const applied: string[] = [];
    const rejected: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (WRITABLE_FIELDS.has(key)) {
        process.env[key] = String(value);
        applied.push(key);
      } else {
        rejected.push(key);
      }
    }

    // Persist to .env.bridge file
    if (applied.length > 0) {
      try {
        const envFile = path.join(config.composeDir, ".env.bridge");
        let content = "";
        try {
          content = fs.readFileSync(envFile, "utf-8");
        } catch {}

        for (const key of applied) {
          const value = process.env[key] || "";
          const regex = new RegExp(`^${key}=.*$`, "m");
          if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
          } else {
            content += `\n${key}=${value}`;
          }
        }

        fs.writeFileSync(envFile, content.trim() + "\n", "utf-8");
      } catch (err: any) {
        return res.status(500).json({
          error: "Settings applied in memory but failed to persist",
          detail: err.message,
          applied,
        });
      }
    }

    res.json({
      applied,
      rejected,
      hint: rejected.length
        ? `These fields are not writable: ${rejected.join(", ")}`
        : undefined,
    });
  });

  return router;
}
