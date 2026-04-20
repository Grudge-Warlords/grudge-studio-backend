/**
 * Gruda Master Node Validator
 *
 * Cross-node state verification for Grudge Studio infrastructure.
 * Each node hashes critical DB tables and compares with peers to detect
 * drift, corruption, or tampering.
 *
 * Validator identities: GRD-V-{NODE} (e.g., GRD-V-LINUXVPS, GRD-V-WIN)
 */

import crypto from "crypto";
import type { BridgeConfig } from "../bridge.config";
import { resolvePeerUrl } from "./peers";

// ── Types ─────────────────────────────────────────────────

export interface TableHash {
  table: string;
  rowCount: number;
  checksum: string;
  timestamp: string;
}

export interface ValidationSnapshot {
  nodeIdentity: string;
  nodeName: string;
  nodeRole: string;
  hashes: TableHash[];
  snapshotId: string;
  timestamp: string;
}

export interface ValidationResult {
  snapshotId: string;
  localNode: string;
  peerNode: string;
  matches: string[];
  mismatches: string[];
  missing: string[];
  consensusReached: boolean;
  timestamp: string;
}

export interface HealthVote {
  fromNode: string;
  fromIdentity: string;
  services: Record<string, "up" | "down" | "degraded">;
  timestamp: string;
}

export interface ValidatorState {
  identity: string;
  enabled: boolean;
  lastSnapshot: ValidationSnapshot | null;
  lastResults: ValidationResult[];
  votes: Map<string, HealthVote>;
  ledger: ValidatorLedgerEntry[];
}

export interface ValidatorLedgerEntry {
  id: string;
  type: "snapshot" | "verify" | "vote" | "alert";
  node: string;
  summary: string;
  timestamp: string;
  details?: unknown;
}

// ── State ─────────────────────────────────────────────────

const MAX_LEDGER_SIZE = 500;

const state: ValidatorState = {
  identity: "",
  enabled: false,
  lastSnapshot: null,
  lastResults: [],
  votes: new Map(),
  ledger: [],
};

// ── Init ──────────────────────────────────────────────────

export function initValidator(config: BridgeConfig): void {
  state.identity = config.validator.identity;
  state.enabled = config.validator.enabled;

  if (!state.enabled) {
    console.log("[validator] Disabled via VALIDATOR_ENABLED=false");
    return;
  }

  console.log(`[validator] Initialized as ${state.identity}`);
}

// ── Snapshot ──────────────────────────────────────────────

/**
 * Generate a validation snapshot by hashing critical DB tables.
 * On the primary node, this queries MySQL directly.
 * On replica nodes, this queries the local DB or relays to primary.
 */
export async function generateSnapshot(
  config: BridgeConfig
): Promise<ValidationSnapshot> {
  const hashes: TableHash[] = [];
  const snapshotId = `SNAP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  for (const table of config.validator.tables) {
    try {
      const hash = await hashTable(config, table);
      hashes.push(hash);
    } catch (err: any) {
      hashes.push({
        table,
        rowCount: -1,
        checksum: `ERROR: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const snapshot: ValidationSnapshot = {
    nodeIdentity: state.identity,
    nodeName: config.nodeName,
    nodeRole: config.nodeRole,
    hashes,
    snapshotId,
    timestamp: new Date().toISOString(),
  };

  state.lastSnapshot = snapshot;

  addLedgerEntry({
    type: "snapshot",
    node: config.nodeName,
    summary: `Generated snapshot ${snapshotId} with ${hashes.length} table hashes`,
    details: { tables: hashes.map((h) => h.table) },
  });

  return snapshot;
}

/**
 * Hash a single table using MySQL CHECKSUM TABLE.
 * Falls back to row count + sampling if checksum isn't available.
 */
async function hashTable(
  config: BridgeConfig,
  table: string
): Promise<TableHash> {
  const sanitizedTable = table.replace(/[^a-zA-Z0-9_]/g, "");
  const { mysqlExec } = await import("./exec");

  const dbOpts = {
    container: config.mysql.container,
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  };

  if (config.nodeRole === "primary") {
    const checksumResult = await mysqlExec(
      config.nodeRole,
      `CHECKSUM TABLE ${sanitizedTable}`,
      dbOpts
    );

    const countResult = await mysqlExec(
      config.nodeRole,
      `SELECT COUNT(*) FROM ${sanitizedTable}`,
      dbOpts
    );

    const checksum = checksumResult.stdout.trim().split("\t").pop() || "unknown";
    const rowCount = parseInt(countResult.stdout.trim().split("\n").pop() || "0", 10);

    return {
      table: sanitizedTable,
      rowCount,
      checksum,
      timestamp: new Date().toISOString(),
    };
  }

  // Replica: return a placeholder — replicas verify against primary snapshots
  return {
    table: sanitizedTable,
    rowCount: -1,
    checksum: "REPLICA_NO_DIRECT_DB",
    timestamp: new Date().toISOString(),
  };
}

// ── Cross-Node Verification ───────────────────────────────

/**
 * Verify local snapshot against all peer nodes.
 * Requests each peer's snapshot and compares table checksums.
 */
export async function verifyAgainstPeers(
  config: BridgeConfig
): Promise<ValidationResult[]> {
  if (!state.lastSnapshot) {
    await generateSnapshot(config);
  }

  const results: ValidationResult[] = [];

  for (const peer of config.peers) {
    const resolved = await resolvePeerUrl(peer, "/api/bridge/health");
    if (!resolved) continue;

    try {
      const resp = await fetch(
        `${resolved.url}/api/bridge/validator/status`,
        {
          headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!resp.ok) continue;

      const peerState = (await resp.json()) as {
        lastSnapshot: ValidationSnapshot | null;
      };

      if (!peerState.lastSnapshot || !state.lastSnapshot) continue;

      const result = compareSnapshots(
        state.lastSnapshot,
        peerState.lastSnapshot
      );
      results.push(result);

      addLedgerEntry({
        type: "verify",
        node: config.nodeName,
        summary: result.consensusReached
          ? `✅ Consensus with ${result.peerNode}: ${result.matches.length} tables match`
          : `⚠️ Mismatch with ${result.peerNode}: ${result.mismatches.join(", ")}`,
        details: result,
      });
    } catch {
      // Peer unreachable
    }
  }

  state.lastResults = results;
  return results;
}

/**
 * Compare two validation snapshots table by table.
 */
function compareSnapshots(
  local: ValidationSnapshot,
  remote: ValidationSnapshot
): ValidationResult {
  const matches: string[] = [];
  const mismatches: string[] = [];
  const missing: string[] = [];

  const remoteMap = new Map(remote.hashes.map((h) => [h.table, h]));

  for (const localHash of local.hashes) {
    const remoteHash = remoteMap.get(localHash.table);

    if (!remoteHash) {
      missing.push(localHash.table);
    } else if (
      localHash.checksum === remoteHash.checksum &&
      localHash.rowCount === remoteHash.rowCount
    ) {
      matches.push(localHash.table);
    } else {
      mismatches.push(localHash.table);
    }
  }

  return {
    snapshotId: `VERIFY-${Date.now()}`,
    localNode: local.nodeName,
    peerNode: remote.nodeName,
    matches,
    mismatches,
    missing,
    consensusReached: mismatches.length === 0 && missing.length === 0,
    timestamp: new Date().toISOString(),
  };
}

// ── Health Votes ──────────────────────────────────────────

export function recordVote(vote: HealthVote): void {
  state.votes.set(vote.fromNode, vote);

  addLedgerEntry({
    type: "vote",
    node: vote.fromNode,
    summary: `Health vote from ${vote.fromNode} (${vote.fromIdentity})`,
    details: vote.services,
  });
}

export function getHealthConsensus(): {
  services: Record<string, { up: number; down: number; degraded: number }>;
  totalVoters: number;
} {
  const services: Record<
    string,
    { up: number; down: number; degraded: number }
  > = {};

  for (const vote of state.votes.values()) {
    for (const [svc, status] of Object.entries(vote.services)) {
      if (!services[svc]) services[svc] = { up: 0, down: 0, degraded: 0 };
      services[svc][status]++;
    }
  }

  return { services, totalVoters: state.votes.size };
}

// ── Ledger ────────────────────────────────────────────────

function addLedgerEntry(
  entry: Omit<ValidatorLedgerEntry, "id" | "timestamp">
): void {
  state.ledger.push({
    ...entry,
    id: `LED-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    timestamp: new Date().toISOString(),
  });

  // Trim to max size
  if (state.ledger.length > MAX_LEDGER_SIZE) {
    state.ledger = state.ledger.slice(-MAX_LEDGER_SIZE);
  }
}

// ── Getters ───────────────────────────────────────────────

export function getValidatorState(): Omit<ValidatorState, "votes"> & {
  votes: HealthVote[];
} {
  return {
    ...state,
    votes: Array.from(state.votes.values()),
  };
}

export function getValidatorLedger(limit = 50): ValidatorLedgerEntry[] {
  return state.ledger.slice(-limit);
}
