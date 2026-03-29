/**
 * Grudge Bridge — Configuration
 *
 * 3-node topology:
 *   Node 1: Linux VPS  (74.208.155.229)  — PRIMARY
 *   Node 2: Win VPS    (Radmin 26.228.21.150 / DESKTOP-AA5O5QR) — REPLICA
 *   Node 3: GrudgeYonko (Radmin 26.x.x.x)  — REPLICA
 *
 * Radmin VPN mesh is the primary inter-node network.
 * ZeroTier (10.147.17.x) is the fallback. Public IP is last resort.
 */

import os from "os";

export type NodeRole = "primary" | "replica";

export interface PeerAddress {
  /** Radmin VPN IP (preferred) */
  radmin?: string;
  /** ZeroTier IP (fallback) */
  zerotier?: string;
  /** Public / LAN IP (last resort) */
  public?: string;
  /** Bridge port */
  port: number;
}

export interface BridgeConfig {
  port: number;
  nodeRole: NodeRole;
  nodeName: string;
  bridgeApiKey: string;

  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    /** Docker container name — used for `docker exec` on primary */
    container: string;
  };

  r2: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    backupPrefix: string;
  };

  /** All peer nodes (parsed from PEER_NODES env) */
  peers: PeerAddress[];

  schedule: {
    dailyCron: string;
    weeklyCron: string;
    dailyRetentionDays: number;
    weeklyRetentionWeeks: number;
  };

  discordWebhookUrl: string;
  composeDir: string;
}

function env(key: string, fallback = ""): string {
  return process.env[key] || fallback;
}

/**
 * Parse PEER_NODES format:
 *   "radmin:26.228.21.150|zt:10.147.17.2|pub:10.0.0.217:4000, radmin:26.1.2.3:4000"
 *
 * Each peer is comma-separated. Within a peer, addresses are pipe-separated
 * with prefixes: radmin:, zt:, pub:
 * Port defaults to 4000 if not specified.
 */
function parsePeers(raw: string): PeerAddress[] {
  if (!raw.trim()) return [];

  return raw.split(",").map((peerStr) => {
    const parts = peerStr.trim().split("|");
    const peer: PeerAddress = { port: 4000 };

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith("radmin:")) {
        const val = trimmed.slice(7);
        const [ip, port] = val.split(":");
        peer.radmin = ip;
        if (port) peer.port = parseInt(port, 10);
      } else if (trimmed.startsWith("zt:")) {
        const val = trimmed.slice(3);
        const [ip, port] = val.split(":");
        peer.zerotier = ip;
        if (port) peer.port = parseInt(port, 10);
      } else if (trimmed.startsWith("pub:")) {
        const val = trimmed.slice(4);
        const [ip, port] = val.split(":");
        peer.public = ip;
        if (port) peer.port = parseInt(port, 10);
      } else {
        // Plain IP:port — treat as radmin
        const [ip, port] = trimmed.split(":");
        peer.radmin = ip;
        if (port) peer.port = parseInt(port, 10);
      }
    }

    return peer;
  });
}

export function loadConfig(): BridgeConfig {
  const apiKey = env("BRIDGE_API_KEY");
  if (!apiKey) {
    console.warn("⚠️  BRIDGE_API_KEY not set — all endpoints will reject requests");
  }

  return {
    port: parseInt(env("PORT", "4000"), 10),
    nodeRole: (env("NODE_ROLE", "replica")) as NodeRole,
    nodeName: env("NODE_NAME", os.hostname()),
    bridgeApiKey: apiKey,

    mysql: {
      host: env("MYSQL_HOST", "localhost"),
      port: parseInt(env("MYSQL_PORT", "3306"), 10),
      database: env("MYSQL_DATABASE", "grudge_game"),
      user: env("MYSQL_USER", "root"),
      password: env("MYSQL_PASSWORD"),
      container: env("MYSQL_CONTAINER", "grudge-mysql"),
    },

    r2: {
      endpoint: env(
        "R2_ENDPOINT",
        "https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com"
      ),
      bucket: env("R2_BUCKET", "grudge-assets"),
      accessKeyId: env("R2_KEY"),
      secretAccessKey: env("R2_SECRET"),
      region: "auto",
      backupPrefix: env("R2_BACKUP_PREFIX", "backups/mysql"),
    },

    peers: parsePeers(env("PEER_NODES")),

    schedule: {
      dailyCron: env("BACKUP_DAILY_CRON", "0 3 * * *"),
      weeklyCron: env("BACKUP_WEEKLY_CRON", "0 3 * * 0"),
      dailyRetentionDays: parseInt(env("BACKUP_DAILY_RETAIN", "14"), 10),
      weeklyRetentionWeeks: parseInt(env("BACKUP_WEEKLY_RETAIN", "8"), 10),
    },

    discordWebhookUrl: env("DISCORD_WEBHOOK_URL"),
    composeDir: env("COMPOSE_DIR", "/opt/grudge-studio-backend"),
  };
}
