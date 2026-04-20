/**
 * Peer Mesh — 3-node bridge discovery + heartbeat
 *
 * Resolution order per peer:
 *   1. Radmin VPN IP  (26.x.x.x — lowest latency, encrypted)
 *   2. ZeroTier IP    (10.147.17.x — fallback VPN)
 *   3. Public/LAN IP  (last resort)
 *
 * Heartbeats run every 30s. Each node POSTs its status to all peers.
 */

import type { BridgeConfig, PeerAddress, NodeRole } from "../bridge.config";

export interface PeerStatus {
  name: string;
  role: NodeRole;
  reachable: boolean;
  latencyMs: number;
  lastSeen: string;
  resolvedVia: "radmin" | "zerotier" | "public" | "unknown";
  resolvedIp: string;
  services?: string[];
  uptime?: number;
}

export interface HeartbeatPayload {
  name: string;
  role: NodeRole;
  timestamp: string;
  services: string[];
  uptime: number;
  /** Validator identity (GRD-V-xxx) */
  validatorIdentity?: string;
  /** Whether validator is enabled */
  validatorEnabled?: boolean;
  /** Legion GRD-17 status */
  legionEnabled?: boolean;
  /** Legion inbox size */
  legionInboxSize?: number;
  /** Number of GRD-17 messages sent */
  legionTotalSent?: number;
}

/** In-memory peer status registry */
const peerRegistry = new Map<string, PeerStatus>();

/** Resolve the best reachable URL for a peer (Radmin → ZeroTier → Public) */
export async function resolvePeerUrl(
  peer: PeerAddress,
  path: string
): Promise<{ url: string; via: PeerStatus["resolvedVia"]; ip: string } | null> {
  const candidates: Array<{
    ip: string;
    via: PeerStatus["resolvedVia"];
  }> = [];

  if (peer.radmin) candidates.push({ ip: peer.radmin, via: "radmin" });
  if (peer.zerotier) candidates.push({ ip: peer.zerotier, via: "zerotier" });
  if (peer.public) candidates.push({ ip: peer.public, via: "public" });

  for (const { ip, via } of candidates) {
    const url = `http://${ip}:${peer.port}${path}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const start = Date.now();
      const resp = await fetch(url, { signal: ctrl.signal, method: "GET" });
      clearTimeout(timer);

      if (resp.ok) {
        return { url: `http://${ip}:${peer.port}`, via, ip };
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

/** Ping a peer and measure latency */
export async function pingPeer(
  peer: PeerAddress,
  apiKey: string
): Promise<PeerStatus> {
  const status: PeerStatus = {
    name: "unknown",
    role: "replica",
    reachable: false,
    latencyMs: -1,
    lastSeen: "",
    resolvedVia: "unknown",
    resolvedIp: "",
  };

  const candidates: Array<{
    ip: string;
    via: PeerStatus["resolvedVia"];
  }> = [];

  if (peer.radmin) candidates.push({ ip: peer.radmin, via: "radmin" });
  if (peer.zerotier) candidates.push({ ip: peer.zerotier, via: "zerotier" });
  if (peer.public) candidates.push({ ip: peer.public, via: "public" });

  for (const { ip, via } of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const start = Date.now();

      const resp = await fetch(
        `http://${ip}:${peer.port}/api/bridge/health`,
        {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      clearTimeout(timer);

      if (resp.ok) {
        const data = (await resp.json()) as any;
        status.reachable = true;
        status.latencyMs = Date.now() - start;
        status.resolvedVia = via;
        status.resolvedIp = ip;
        status.name = data.nodeName || "unknown";
        status.role = data.nodeRole || "replica";
        status.lastSeen = new Date().toISOString();
        status.services = data.services;
        status.uptime = data.uptime;

        // Cache in registry
        peerRegistry.set(ip, status);
        return status;
      }
    } catch {
      // Try next
    }
  }

  return status;
}

/** Ping all configured peers and return aggregated status */
export async function pingAllPeers(config: BridgeConfig): Promise<PeerStatus[]> {
  const results = await Promise.all(
    config.peers.map((peer) => pingPeer(peer, config.bridgeApiKey))
  );
  return results;
}

/** Send a heartbeat to all peers */
export async function broadcastHeartbeat(config: BridgeConfig): Promise<void> {
  const payload: HeartbeatPayload = {
    name: config.nodeName,
    role: config.nodeRole,
    timestamp: new Date().toISOString(),
    services: [],
    uptime: process.uptime(),
    validatorIdentity: config.validator.identity,
    validatorEnabled: config.validator.enabled,
    legionEnabled: config.legion.enabled,
  };

  for (const peer of config.peers) {
    const resolved = await resolvePeerUrl(peer, "/api/bridge/health");
    if (!resolved) continue;

    try {
      await fetch(`${resolved.url}/api/bridge/nodes/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bridgeApiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Peer unreachable, skip
    }
  }
}

/** Record an incoming heartbeat from a peer */
export function recordHeartbeat(payload: HeartbeatPayload, fromIp: string): void {
  peerRegistry.set(payload.name, {
    name: payload.name,
    role: payload.role,
    reachable: true,
    latencyMs: 0,
    lastSeen: payload.timestamp,
    resolvedVia: "unknown",
    resolvedIp: fromIp,
    services: payload.services,
    uptime: payload.uptime,
  });
}

/** Get all known peers from the registry */
export function getKnownPeers(): PeerStatus[] {
  return Array.from(peerRegistry.values());
}

/**
 * Relay a command to the primary node.
 * Used by replica nodes to forward deploy/dump requests.
 */
export async function relayToPrimary(
  config: BridgeConfig,
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; data: unknown } | null> {
  // Find the primary peer
  for (const peer of config.peers) {
    const resolved = await resolvePeerUrl(peer, "/api/bridge/health");
    if (!resolved) continue;

    try {
      const resp = await fetch(`${resolved.url}/api/bridge/health`, {
        headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as any;
      if (data.nodeRole !== "primary") continue;

      // This is the primary — relay the command
      const relayResp = await fetch(`${resolved.url}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bridgeApiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      return {
        status: relayResp.status,
        data: await relayResp.json().catch(() => relayResp.text()),
      };
    } catch {
      continue;
    }
  }

  return null;
}

/** Start the heartbeat interval (call once at startup) */
export function startHeartbeatLoop(config: BridgeConfig): NodeJS.Timeout {
  return setInterval(() => {
    broadcastHeartbeat(config).catch((err) =>
      console.error("Heartbeat broadcast failed:", err.message)
    );
  }, 30_000);
}
