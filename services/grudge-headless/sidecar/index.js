#!/usr/bin/env node
/**
 * GRUDGE HEADLESS — Sidecar Process
 *
 * Runs alongside the Unity headless server binary inside the same container.
 * Responsibilities:
 *   1. Register this server instance with game-api on startup
 *   2. Send heartbeat every 10 seconds (pvp-server-manager expects <30s)
 *   3. Connect to ws-service /pvp as an internal client to:
 *      - Receive match assignments (pvp:match_start)
 *      - Push authoritative game state to clients (pvp:game_state)
 *      - Submit match results (pvp:server_match_end)
 *   4. Monitor the Unity process — if it dies, deregister and exit
 *
 * Env vars:
 *   SERVER_ID         — Unique ID for this instance (default: hostname-based)
 *   GAME_API_URL      — e.g. http://game-api:3003
 *   WS_SERVICE_URL    — e.g. http://ws-service:3007
 *   INTERNAL_API_KEY  — Shared secret for service-to-service auth
 *   SERVER_HOST       — Public hostname/IP clients connect to (default: container hostname)
 *   SERVER_PORT       — Game port (default: 7777)
 *   MAX_PLAYERS       — Server capacity (default: 22)
 *   UNITY_PID_FILE    — Path to file containing Unity PID (default: /tmp/unity.pid)
 */

const http = require('http');
const os   = require('os');
const fs   = require('fs');

// ── Config ─────────────────────────────────────────────────────
const SERVER_ID       = process.env.SERVER_ID || `gs-${os.hostname()}`;
const GAME_API_URL    = process.env.GAME_API_URL || 'http://game-api:3003';
const WS_SERVICE_URL  = process.env.WS_SERVICE_URL || 'http://ws-service:3007';
const INTERNAL_KEY    = process.env.INTERNAL_API_KEY;
const SERVER_HOST     = process.env.SERVER_HOST || os.hostname();
const SERVER_PORT     = Number(process.env.SERVER_PORT) || 7777;
const MAX_PLAYERS     = Number(process.env.MAX_PLAYERS) || 22;
const UNITY_PID_FILE  = process.env.UNITY_PID_FILE || '/tmp/unity.pid';
const HEARTBEAT_MS    = 10_000;   // 10 seconds
const HEALTH_CHECK_MS = 5_000;    // check Unity process every 5s

let currentLobbyCode = null;
let currentPlayers   = 0;
let shuttingDown     = false;

// ── HTTP helpers ───────────────────────────────────────────────

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(GAME_API_URL);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 3003,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length':  Buffer.byteLength(payload),
        'x-internal-key': INTERNAL_KEY,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Registration + Heartbeat ───────────────────────────────────

async function register() {
  try {
    const res = await apiPost('/pvp/server/register', {
      server_id:       SERVER_ID,
      host:            SERVER_HOST,
      port:            SERVER_PORT,
      capacity:        MAX_PLAYERS,
      current_players: currentPlayers,
    });
    if (res.status === 200) {
      console.log(`[sidecar] Registered ${SERVER_ID} (${SERVER_HOST}:${SERVER_PORT}) — capacity ${MAX_PLAYERS}`);
    } else {
      console.warn(`[sidecar] Registration response: ${res.status}`, res.body);
    }
  } catch (e) {
    console.error(`[sidecar] Registration failed:`, e.message);
  }
}

async function heartbeat() {
  try {
    await apiPost('/pvp/server/register', {
      server_id:       SERVER_ID,
      host:            SERVER_HOST,
      port:            SERVER_PORT,
      capacity:        MAX_PLAYERS,
      current_players: currentPlayers,
    });
  } catch (e) {
    console.warn(`[sidecar] Heartbeat failed:`, e.message);
  }
}

async function deregister() {
  try {
    const urlObj = new URL(GAME_API_URL);
    await new Promise((resolve) => {
      const req = http.request({
        hostname: urlObj.hostname,
        port:     Number(urlObj.port) || 3003,
        path:     `/pvp/server/${SERVER_ID}`,
        method:   'DELETE',
        headers:  { 'x-internal-key': INTERNAL_KEY },
      }, resolve);
      req.on('error', resolve);
      req.setTimeout(3000, () => { req.destroy(); resolve(); });
      req.end();
    });
    console.log(`[sidecar] Deregistered ${SERVER_ID}`);
  } catch {
    // best-effort
  }
}

// ── Unity process monitoring ───────────────────────────────────

function getUnityPid() {
  // Try PID file first, then scan for the process
  try {
    if (fs.existsSync(UNITY_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(UNITY_PID_FILE, 'utf8').trim(), 10);
      if (pid > 0) return pid;
    }
  } catch {}
  return null;
}

function isUnityRunning() {
  const pid = getUnityPid();
  if (!pid) {
    // Fall back to process name check (Linux)
    try {
      const { execSync } = require('child_process');
      const out = execSync('pgrep -f GrudgeLinuxServer', { encoding: 'utf8', timeout: 2000 });
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

// ── Socket.IO connection to ws-service ─────────────────────────

let ioClient = null;

function connectWs() {
  // Lazy-require socket.io-client (installed in container)
  let ioModule;
  try {
    ioModule = require('socket.io-client');
  } catch {
    console.warn('[sidecar] socket.io-client not available — WS relay disabled');
    return;
  }

  ioClient = ioModule(WS_SERVICE_URL + '/pvp', {
    auth: { internal_key: INTERNAL_KEY },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  ioClient.on('connect', () => {
    console.log(`[sidecar] Connected to ws-service /pvp`);
  });

  ioClient.on('connect_error', (err) => {
    console.warn(`[sidecar] WS connect error:`, err.message);
  });

  // Listen for match assignments — when game-api allocates this server to a lobby,
  // the pvp:match_start event includes our server_id in the server field.
  // The sidecar doesn't directly receive allocations — the Unity server polls
  // or the sidecar can watch the Redis key. For now, log assignments.
  ioClient.on('pvp:match_start', (data) => {
    if (data?.server?.server_id === SERVER_ID) {
      currentLobbyCode = data.lobby_code;
      currentPlayers   = data.players?.length || 0;
      console.log(`[sidecar] Match assigned: ${data.lobby_code} (${data.mode}) — ${currentPlayers} players`);
      // TODO: Signal Unity process about new match via local HTTP/file/pipe
    }
  });
}

// ── Graceful shutdown ──────────────────────────────────────────

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sidecar] ${signal} received — shutting down`);
  await deregister();
  if (ioClient) ioClient.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log(`[sidecar] Starting for server ${SERVER_ID}`);
  console.log(`[sidecar] Game API: ${GAME_API_URL}`);
  console.log(`[sidecar] WS:       ${WS_SERVICE_URL}`);
  console.log(`[sidecar] Host:     ${SERVER_HOST}:${SERVER_PORT}`);

  if (!INTERNAL_KEY) {
    console.error('[sidecar] INTERNAL_API_KEY is required');
    process.exit(1);
  }

  // Wait briefly for Unity to start before registering
  await new Promise(r => setTimeout(r, 3000));

  // Register with game-api
  await register();

  // Connect to ws-service for real-time events
  connectWs();

  // Heartbeat loop
  const hbInterval = setInterval(heartbeat, HEARTBEAT_MS);

  // Unity health check loop
  const healthInterval = setInterval(async () => {
    if (!isUnityRunning()) {
      console.error('[sidecar] Unity process not found — deregistering and exiting');
      clearInterval(hbInterval);
      clearInterval(healthInterval);
      await deregister();
      if (ioClient) ioClient.close();
      process.exit(1);
    }
  }, HEALTH_CHECK_MS);

  console.log(`[sidecar] Running — heartbeat every ${HEARTBEAT_MS / 1000}s, health check every ${HEALTH_CHECK_MS / 1000}s`);
}

main().catch((e) => {
  console.error('[sidecar] Fatal error:', e);
  process.exit(1);
});
