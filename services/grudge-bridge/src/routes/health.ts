import { Router, type Request, type Response } from "express";
import type { BridgeConfig } from "../bridge.config";

export function healthRoutes(config: BridgeConfig): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      service: "grudge-bridge",
      version: "1.0.0",
      nodeName: config.nodeName,
      nodeRole: config.nodeRole,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      config: {
        mysqlHost: config.mysql.host,
        mysqlConfigured: !!config.mysql.password,
        r2Configured: !!(config.r2.accessKeyId && config.r2.secretAccessKey),
        peersConfigured: config.peers.length,
        backupSchedule: config.nodeRole === "primary"
          ? { daily: config.schedule.dailyCron, weekly: config.schedule.weeklyCron }
          : "n/a (replica)",
      },
    });
  });

  return router;
}
