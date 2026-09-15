/**
 * Grudge Bridge — 3-Node VPS Operations Manager
 *
 * Runs on all three Grudge infrastructure nodes:
 *   Node 1: Linux VPS    (PRIMARY)  — dump, restore, deploy, backup scheduler
 *   Node 2: Windows VPS  (REPLICA)  — relay to primary, local health, legion node
 *   Node 3: GrudgeYonko  (REPLICA)  — relay to primary, dev builds, backup verify
 *
 * Connected via Radmin VPN mesh → ZeroTier fallback → public IP last resort.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cron from "node-cron";
import { loadConfig, type BridgeConfig } from "./bridge.config";
import { startHeartbeatLoop } from "./lib/peers";

// Routes
import { healthRoutes } from "./routes/health";
import { dumpRoutes } from "./routes/dump";
import { restoreRoutes } from "./routes/restore";
import { backupsRoutes } from "./routes/backups";
import { settingsRoutes } from "./routes/settings";
import { deployRoutes } from "./routes/deploy";
import { nodesRoutes } from "./routes/nodes";

// ── Load config ───────────────────────────────────────────
const config = loadConfig();
const app = express();

app.use(express.json({ limit: "50mb" }));

// ── CORS ──────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Auth middleware ────────────────────────────────────────
// All /api/bridge/* routes require Bearer token (except health for basic ping)
function authGuard(req: Request, res: Response, next: NextFunction): void {
  // Allow unauthenticated health check for basic reachability
  if (req.path === "/api/bridge/health" && req.method === "GET") {
    return next();
  }

  if (!config.bridgeApiKey) {
    res.status(503).json({
      error: "Bridge not configured",
      hint: "Set BRIDGE_API_KEY environment variable",
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization: Bearer <BRIDGE_API_KEY>" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.bridgeApiKey) {
    res.status(403).json({ error: "Invalid BRIDGE_API_KEY" });
    return;
  }

  next();
}

app.use(authGuard);

// ── Request logging ───────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Register routes ───────────────────────────────────────
app.use("/api/bridge", healthRoutes(config));
app.use("/api/bridge", dumpRoutes(config));
app.use("/api/bridge", restoreRoutes(config));
app.use("/api/bridge", backupsRoutes(config));
app.use("/api/bridge", settingsRoutes(config));
app.use("/api/bridge", deployRoutes(config));
app.use("/api/bridge", nodesRoutes(config));

// ── 404 catch-all ─────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", service: "grudge-bridge" });
});

// ── Backup cron schedule (PRIMARY only) ───────────────────
if (config.nodeRole === "primary") {
  // Daily backup
  cron.schedule(config.schedule.dailyCron, async () => {
    console.log("⏰ Cron: Starting daily backup...");
    try {
      const resp = await fetch(`http://localhost:${config.port}/api/bridge/dump`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bridgeApiKey}`,
        },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await resp.json();
      console.log("⏰ Daily backup result:", data);

      if (!resp.ok && config.discordWebhookUrl) {
        await notifyDiscord(config, `❌ Daily backup failed: ${JSON.stringify(data)}`);
      }
    } catch (err: any) {
      console.error("⏰ Daily backup failed:", err.message);
      if (config.discordWebhookUrl) {
        await notifyDiscord(config, `❌ Daily backup error: ${err.message}`);
      }
    }
  });

  // Weekly backup
  cron.schedule(config.schedule.weeklyCron, async () => {
    console.log("⏰ Cron: Starting weekly backup...");
    try {
      const resp = await fetch(`http://localhost:${config.port}/api/bridge/dump`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bridgeApiKey}`,
        },
        body: JSON.stringify({ type: "weekly" }),
      });
      const data = await resp.json();
      console.log("⏰ Weekly backup result:", data);
    } catch (err: any) {
      console.error("⏰ Weekly backup failed:", err.message);
    }
  });

  console.log(`📅 Backup schedule: daily="${config.schedule.dailyCron}", weekly="${config.schedule.weeklyCron}"`);
}

// ── Start heartbeat loop ──────────────────────────────────
if (config.peers.length > 0) {
  startHeartbeatLoop(config);
  console.log(`💓 Heartbeat loop started (30s interval, ${config.peers.length} peers)`);
}

// ── Start server ──────────────────────────────────────────
app.listen(config.port, "0.0.0.0", () => {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  Grudge Bridge — 3-Node VPS Operations Manager");
  console.log(`  Node:  ${config.nodeName} (${config.nodeRole.toUpperCase()})`);
  console.log(`  Port:  ${config.port}`);
  console.log(`  MySQL: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
  console.log(`  R2:    ${config.r2.bucket} (${config.r2.accessKeyId ? "configured" : "NOT configured"})`);
  console.log(`  Peers: ${config.peers.length} configured`);
  console.log("═══════════════════════════════════════════════");
  console.log("");
});

// ── Discord webhook helper ────────────────────────────────
async function notifyDiscord(cfg: BridgeConfig, message: string): Promise<void> {
  if (!cfg.discordWebhookUrl) return;
  try {
    await fetch(cfg.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**[Grudge Bridge — ${cfg.nodeName}]** ${message}`,
      }),
    });
  } catch {}
}
