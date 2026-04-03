import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
import type { BridgeConfig } from "../bridge.config";
import { relayToPrimary } from "../lib/peers";

/** Services to rebuild in order (same as deploy-migrate.sh) */
const DEPLOY_ORDER = [
  "ai-agent",
  "wallet-service",
  "account-api",
  "launcher-api",
  "asset-service",
  "game-api",
  "grudge-id",
  "ws-service",
];

export function deployRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * POST /api/bridge/deploy
   * Body: { services?: string[] }  — optional subset; defaults to all
   *
   * Primary-only. Replicas relay to primary via Radmin mesh.
   * Streams progress via Server-Sent Events (SSE).
   */
  router.post("/deploy", async (req: Request, res: Response) => {
    // Replicas relay
    if (config.nodeRole !== "primary") {
      const relayed = await relayToPrimary(
        config,
        "/api/bridge/deploy",
        "POST",
        req.body
      );
      if (relayed) {
        return res.status(relayed.status).json(relayed.data);
      }
      return res.status(502).json({ error: "Cannot reach primary node" });
    }

    const services = (req.body?.services as string[]) || DEPLOY_ORDER;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("start", {
      services,
      timestamp: new Date().toISOString(),
      composeDir: config.composeDir,
    });

    // 1. Git pull (optional)
    try {
      send("step", { phase: "git-pull", status: "running" });
      const pullResult = await execCommand("git", ["pull", "origin", "main"], config.composeDir);
      send("step", { phase: "git-pull", status: "done", output: pullResult.trim() });
    } catch (err: any) {
      send("step", { phase: "git-pull", status: "skipped", error: err.message });
    }

    // 2. Run migrations
    try {
      send("step", { phase: "migrations", status: "running" });
      const migrateResult = await execCommand(
        "bash",
        [`${config.composeDir}/scripts/migrate.sh`],
        config.composeDir
      );
      send("step", { phase: "migrations", status: "done", output: migrateResult.slice(0, 500) });
    } catch (err: any) {
      send("step", { phase: "migrations", status: "skipped", error: err.message });
    }

    // 3. Rolling rebuild per service
    const results: Array<{ service: string; status: string; duration: number }> = [];

    for (const svc of services) {
      send("service", { service: svc, status: "building" });
      const start = Date.now();

      try {
        // Build
        await execCommand(
          "docker",
          ["compose", "build", "--build-arg", "BUILDKIT_INLINE_CACHE=1", svc],
          config.composeDir,
          { DOCKER_BUILDKIT: "1" }
        );

        // Restart just this service
        await execCommand(
          "docker",
          ["compose", "up", "-d", "--no-deps", svc],
          config.composeDir
        );

      const duration = Date.now() - start;
        results.push({ service: svc, status: "ok", duration });
        send("service", { service: svc, status: "ok", duration });
        logDeployEvent(config, { service: svc, status: "ok",   event_type: "deploy", details: `${duration}ms` });
      } catch (err: any) {
        const duration = Date.now() - start;
        results.push({ service: svc, status: "failed", duration });
        send("service", { service: svc, status: "failed", error: err.message, duration });
        logDeployEvent(config, { service: svc, status: "failed", event_type: "deploy", details: err.message.slice(0, 200) });
      }

      // Brief pause between services
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 4. Prune old images
    try {
      await execCommand("docker", ["image", "prune", "-f"], config.composeDir);
    } catch {}

    // 5. Health checks
    send("step", { phase: "health-checks", status: "running" });
    await new Promise((r) => setTimeout(r, 10000));

    const healthResults: Array<{ service: string; healthy: boolean }> = [];
    const healthPorts: Record<string, number> = {
      "grudge-id": 3001,
      "game-api": 3003,
      "ai-agent": 3004,
      "account-api": 3005,
      "launcher-api": 3006,
      "ws-service": 3007,
      "asset-service": 3008,
    };

    for (const svc of services) {
      const port = healthPorts[svc];
      if (!port) continue;

      let healthy = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3000);
          const resp = await fetch(`http://localhost:${port}/health`, {
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (resp.ok) {
            healthy = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 4000));
      }

      healthResults.push({ service: svc, healthy });
      send("health", { service: svc, healthy });
    }

    const failed = healthResults.filter((h) => !h.healthy);
    send("complete", {
      success: failed.length === 0,
      services: results,
      health: healthResults,
      failedCount: failed.length,
    });

    res.end();
  });

  return router;
}

/** Fire-and-forget: write a deploy event to the game-api dash_events table */
function logDeployEvent(
  config: import("../bridge.config").BridgeConfig,
  data: { service: string; status: string; event_type?: string; details?: string }
): void {
  if (!config.gameApiUrl || !config.internalApiKey) return;
  fetch(`${config.gameApiUrl}/admin/deploy/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": config.internalApiKey,
    },
    body: JSON.stringify({
      event_type: data.event_type || "deploy",
      service:    data.service,
      status:     data.status,
      actor:      `bridge:${config.nodeName}`,
      details:    data.details,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // never throw
}

function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000, // 10 min
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (d) => stdout.push(d));
    child.stderr?.on("data", (d) => stderr.push(d));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"));
      } else {
        reject(
          new Error(
            `${cmd} exited ${code}: ${Buffer.concat(stderr).toString("utf-8").slice(0, 300)}`
          )
        );
      }
    });
    child.on("error", reject);
  });
}
