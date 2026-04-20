import { Router, type Request, type Response } from "express";
import type { BridgeConfig } from "../bridge.config";
import {
  createEnvelope,
  sendMessage,
  receiveMessage,
  acknowledgeMessage,
  routeAIRequest,
  getLegionStatus,
  getInbox,
  purgeExpired,
  type GRD17MessageType,
  type AIRequestPayload,
} from "../lib/legion";

export function legionRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * GET /api/bridge/legion/status
   * Returns Legion AI mesh status: connected agents, message backlog, providers.
   */
  router.get("/legion/status", (_req: Request, res: Response) => {
    const status = getLegionStatus(config);
    res.json(status);
  });

  /**
   * POST /api/bridge/legion/send
   * Send a GRD-17 message to a peer node.
   * Body: { type, toNode, payload, replyTo? }
   */
  router.post("/legion/send", async (req: Request, res: Response) => {
    if (!config.legion.enabled) {
      return res.status(503).json({ error: "Legion GRD-17 disabled" });
    }

    const { type, toNode, payload, replyTo } = req.body;

    if (!type || !toNode || payload === undefined) {
      return res.status(400).json({
        error: "Missing required fields: type, toNode, payload",
      });
    }

    const envelope = createEnvelope(
      config,
      type as GRD17MessageType,
      toNode,
      payload,
      replyTo
    );

    const result = await sendMessage(config, envelope);

    res.json({
      messageId: envelope.messageId,
      seq: envelope.seq,
      delivered: result.delivered,
      failed: result.failed,
    });
  });

  /**
   * POST /api/bridge/legion/receive
   * Internal endpoint — receives a GRD-17 message from a peer.
   * Called by peer nodes' sendMessage().
   */
  router.post("/legion/receive", (req: Request, res: Response) => {
    if (!config.legion.enabled) {
      return res.status(503).json({ error: "Legion GRD-17 disabled" });
    }

    const envelope = req.body;
    const result = receiveMessage(config, envelope);

    if (result.accepted) {
      res.json({ accepted: true, messageId: envelope.messageId });
    } else {
      res.status(400).json({ accepted: false, reason: result.reason });
    }
  });

  /**
   * GET /api/bridge/legion/inbox
   * Returns pending GRD-17 messages for this node.
   * Query: ?limit=50
   */
  router.get("/legion/inbox", (req: Request, res: Response) => {
    const limit = Math.min(
      parseInt(req.query.limit as string, 10) || 50,
      200
    );
    const messages = getInbox(limit);
    res.json({ messages, count: messages.length });
  });

  /**
   * POST /api/bridge/legion/ack
   * Acknowledge (consume) a GRD-17 message.
   * Body: { messageId }
   */
  router.post("/legion/ack", (req: Request, res: Response) => {
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: "Missing messageId" });
    }

    const acked = acknowledgeMessage(messageId);

    if (acked) {
      res.json({ acknowledged: true, messageId });
    } else {
      res.status(404).json({ acknowledged: false, error: "Message not found in inbox" });
    }
  });

  /**
   * POST /api/bridge/legion/ai/:action
   * Proxy an AI request through GRD-17 to the best available node.
   * Actions: mission, companion, faction, lore, art, chat, narrate, balance
   */
  router.post("/legion/ai/:action", async (req: Request, res: Response) => {
    if (!config.legion.enabled) {
      return res.status(503).json({ error: "Legion GRD-17 disabled" });
    }

    const action = req.params.action as AIRequestPayload["action"];
    const validActions = [
      "mission", "companion", "faction", "lore",
      "art", "chat", "narrate", "balance",
    ];

    if (!validActions.includes(action)) {
      return res.status(400).json({
        error: `Invalid AI action: ${action}`,
        valid: validActions,
      });
    }

    try {
      const result = await routeAIRequest(config, {
        action,
        body: req.body,
        grudgeId: req.body.grudge_id || req.body.grudgeId,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/bridge/legion/purge
   * Purge expired messages from inbox/outbox.
   */
  router.post("/legion/purge", (_req: Request, res: Response) => {
    const result = purgeExpired();
    res.json(result);
  });

  return router;
}
