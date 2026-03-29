import { Router, type Request, type Response } from "express";
import type { BridgeConfig } from "../bridge.config";
import {
  getValidatorState,
  getValidatorLedger,
  generateSnapshot,
  verifyAgainstPeers,
  recordVote,
  getHealthConsensus,
  type HealthVote,
} from "../lib/validator";

export function validatorRoutes(config: BridgeConfig): Router {
  const router = Router();

  /**
   * GET /api/bridge/validator/status
   * Returns current validator state, identity, last snapshot, and results.
   */
  router.get("/validator/status", (_req: Request, res: Response) => {
    const state = getValidatorState();
    res.json({
      identity: state.identity,
      enabled: state.enabled,
      lastSnapshot: state.lastSnapshot,
      lastResults: state.lastResults,
      voteCount: state.votes.length,
      consensus: getHealthConsensus(),
    });
  });

  /**
   * POST /api/bridge/validator/verify
   * Trigger a fresh snapshot and cross-node verification.
   */
  router.post("/validator/verify", async (_req: Request, res: Response) => {
    if (!config.validator.enabled) {
      return res.status(503).json({ error: "Validator disabled" });
    }

    try {
      const snapshot = await generateSnapshot(config);
      const results = await verifyAgainstPeers(config);

      res.json({
        snapshot: {
          id: snapshot.snapshotId,
          tables: snapshot.hashes.length,
          timestamp: snapshot.timestamp,
        },
        verification: {
          peersChecked: results.length,
          allConsensus: results.every((r) => r.consensusReached),
          results,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/bridge/validator/ledger
   * Returns recent validation events.
   * Query: ?limit=50 (default 50, max 500)
   */
  router.get("/validator/ledger", (req: Request, res: Response) => {
    const limit = Math.min(
      parseInt(req.query.limit as string, 10) || 50,
      500
    );
    const ledger = getValidatorLedger(limit);
    res.json({ entries: ledger, count: ledger.length });
  });

  /**
   * POST /api/bridge/validator/vote
   * Submit a health/state vote from a peer node.
   * Body: HealthVote
   */
  router.post("/validator/vote", (req: Request, res: Response) => {
    const vote = req.body as HealthVote;

    if (!vote?.fromNode || !vote?.fromIdentity || !vote?.services) {
      return res.status(400).json({ error: "Invalid vote payload" });
    }

    recordVote(vote);
    res.json({ recorded: true, from: vote.fromNode });
  });

  return router;
}
