import { Router, type Request, type Response } from "express";
import type { BridgeConfig } from "../bridge.config";
import {
  pingAllPeers,
  getKnownPeers,
  recordHeartbeat,
  type HeartbeatPayload,
} from "../lib/peers";

export function nodesRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * GET /api/bridge/nodes
   * Returns this node's info + all known peers with connectivity status.
   */
  router.get("/nodes", async (req: Request, res: Response) => {
    const refresh = req.query.refresh === "true";

    // Optionally ping all peers for fresh data
    let peerStatuses = getKnownPeers();
    if (refresh || peerStatuses.length === 0) {
      peerStatuses = await pingAllPeers(config);
    }

    res.json({
      self: {
        name: config.nodeName,
        role: config.nodeRole,
        uptime: process.uptime(),
        peersConfigured: config.peers.length,
      },
      peers: peerStatuses,
      mesh: {
        totalNodes: 1 + peerStatuses.length,
        reachable: peerStatuses.filter((p) => p.reachable).length + 1,
        unreachable: peerStatuses.filter((p) => !p.reachable).length,
      },
    });
  });

  /**
   * POST /api/bridge/nodes/heartbeat
   * Body: HeartbeatPayload
   *
   * Called by peer nodes every 30s to report their status.
   */
  router.post("/nodes/heartbeat", (req: Request, res: Response) => {
    const payload = req.body as HeartbeatPayload;

    if (!payload?.name || !payload?.role) {
      return res.status(400).json({ error: "Invalid heartbeat payload" });
    }

    const fromIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    recordHeartbeat(payload, fromIp);

    res.json({ received: true, from: payload.name });
  });

  /**
   * GET /api/bridge/nodes/ping
   * Actively pings all configured peers and returns fresh results.
   */
  router.get("/nodes/ping", async (_req: Request, res: Response) => {
    const results = await pingAllPeers(config);
    res.json({
      pingedAt: new Date().toISOString(),
      results,
    });
  });

  return router;
}
