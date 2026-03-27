/**
 * GRUDGE STUDIO — PvP Server Manager
 *
 * Manages headless game server instances for PvP matches.
 * Server instances register themselves in Redis and this module
 * allocates available servers to lobbies when matches start.
 *
 * Redis keys:
 *   pvp:servers                     — Hash of server_id → JSON { host, port, status, capacity, current_players, lobby_code }
 *   pvp:server:<server_id>:heartbeat — Expires after 30s, used for liveness check
 *
 * Server statuses: 'idle' | 'allocated' | 'in_match' | 'draining'
 */

const { getRedis } = require('./redis');

const SERVER_HEARTBEAT_TTL = 30; // seconds — server must heartbeat within this
const SERVER_KEY = 'pvp:servers';

/**
 * Register or heartbeat a game server instance.
 * Called by the headless server on startup and every 10s.
 *
 * @param {string} server_id   — Unique ID for this server instance (e.g. "gs-1", "vps2-gs-1")
 * @param {object} info        — { host, port, capacity, current_players? }
 */
async function registerServer(server_id, { host, port, capacity = 22, current_players = 0 }) {
  const redis = getRedis();
  const existing = await redis.hget(SERVER_KEY, server_id);
  let data;

  if (existing) {
    try {
      data = JSON.parse(existing);
      data.host = host;
      data.port = port;
      data.capacity = capacity;
      data.current_players = current_players;
      data.last_heartbeat = Date.now();
    } catch {
      data = null;
    }
  }

  if (!data) {
    data = {
      server_id,
      host,
      port,
      status: 'idle',
      capacity,
      current_players,
      lobby_code: null,
      registered_at: Date.now(),
      last_heartbeat: Date.now(),
    };
  }

  await redis.hset(SERVER_KEY, server_id, JSON.stringify(data));
  await redis.set(`pvp:server:${server_id}:heartbeat`, '1', 'EX', SERVER_HEARTBEAT_TTL);
}

/**
 * Allocate an idle server for a PvP match.
 * Returns { server_id, host, port } or null if no servers available.
 *
 * @param {string} lobby_code — The lobby code to assign
 * @param {number} player_count — Number of players that need to fit
 */
async function allocateServer(lobby_code, player_count = 2) {
  const redis = getRedis();
  const all = await redis.hgetall(SERVER_KEY);

  let bestServer = null;
  let bestCapacity = Infinity;

  for (const [sid, raw] of Object.entries(all)) {
    try {
      const srv = JSON.parse(raw);
      // Check liveness
      const alive = await redis.exists(`pvp:server:${sid}:heartbeat`);
      if (!alive) {
        // Server missed heartbeat — mark stale, skip
        srv.status = 'stale';
        await redis.hset(SERVER_KEY, sid, JSON.stringify(srv));
        continue;
      }
      // Only pick idle servers with enough capacity
      if (srv.status === 'idle' && srv.capacity >= player_count) {
        if (srv.capacity < bestCapacity) {
          bestServer = srv;
          bestCapacity = srv.capacity;
        }
      }
    } catch { continue; }
  }

  if (!bestServer) return null;

  // Mark allocated
  bestServer.status = 'allocated';
  bestServer.lobby_code = lobby_code;
  bestServer.current_players = 0;
  await redis.hset(SERVER_KEY, bestServer.server_id, JSON.stringify(bestServer));

  return {
    server_id: bestServer.server_id,
    host: bestServer.host,
    port: bestServer.port,
  };
}

/**
 * Mark a server as in_match (game started).
 */
async function markInMatch(server_id, player_count) {
  const redis = getRedis();
  const raw = await redis.hget(SERVER_KEY, server_id);
  if (!raw) return;
  try {
    const srv = JSON.parse(raw);
    srv.status = 'in_match';
    srv.current_players = player_count;
    await redis.hset(SERVER_KEY, server_id, JSON.stringify(srv));
  } catch {}
}

/**
 * Release a server back to idle after match ends.
 */
async function releaseServer(server_id) {
  const redis = getRedis();
  const raw = await redis.hget(SERVER_KEY, server_id);
  if (!raw) return;
  try {
    const srv = JSON.parse(raw);
    srv.status = 'idle';
    srv.lobby_code = null;
    srv.current_players = 0;
    await redis.hset(SERVER_KEY, server_id, JSON.stringify(srv));
  } catch {}
}

/**
 * Remove a server from the pool.
 */
async function deregisterServer(server_id) {
  const redis = getRedis();
  await redis.hdel(SERVER_KEY, server_id);
  await redis.del(`pvp:server:${server_id}:heartbeat`);
}

/**
 * List all registered servers.
 */
async function listServers() {
  const redis = getRedis();
  const all = await redis.hgetall(SERVER_KEY);
  const servers = [];
  for (const [sid, raw] of Object.entries(all)) {
    try {
      const srv = JSON.parse(raw);
      const alive = await redis.exists(`pvp:server:${sid}:heartbeat`);
      srv.alive = !!alive;
      servers.push(srv);
    } catch {}
  }
  return servers;
}

module.exports = {
  registerServer,
  allocateServer,
  markInMatch,
  releaseServer,
  deregisterServer,
  listServers,
};
