/**
 * game-api/db.js — Resilient MySQL pool
 *
 * Features:
 *   - Exponential-backoff startup retry (survives MySQL slow boot in Docker)
 *   - TCP keepalive to prevent idle connection resets behind NAT/Traefik
 *   - Automatic stale-connection eviction via idleTimeout
 *   - Periodic health ping every 30s — detects dead pools early
 *   - Pool-level error listener — prevents unhandled crash on transient errors
 *   - isHealthy() export for /health endpoint deep-check
 */
const mysql = require('mysql2/promise');

const TAG = '[game-api:db]';

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_RETRIES       = 15;          // startup retries before giving up
const INITIAL_DELAY_MS  = 1_000;       // first retry delay (doubles each time)
const MAX_DELAY_MS      = 30_000;      // cap on retry delay
const PING_INTERVAL_MS  = 30_000;      // periodic connection validation
const POOL_SIZE         = 20;          // max simultaneous connections
const IDLE_TIMEOUT_MS   = 60_000;      // recycle idle connections after 60s
const CONNECT_TIMEOUT   = 10_000;      // per-connection TCP timeout

let pool = null;
let healthy = false;
let pingTimer = null;

// ── Pool creation ─────────────────────────────────────────────────────────────
function createPool() {
  const p = mysql.createPool({
    host:               process.env.DB_HOST,
    port:               parseInt(process.env.DB_PORT, 10) || 3306,
    database:           process.env.DB_NAME,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit:    POOL_SIZE,
    queueLimit:         0,
    charset:            'utf8mb4',
    connectTimeout:     CONNECT_TIMEOUT,
    enableKeepAlive:    true,             // TCP keepalive — prevents stale sockets
    keepAliveInitialDelay: 30_000,        // first keepalive probe after 30s idle
    idleTimeout:        IDLE_TIMEOUT_MS,  // mysql2 ≥3.6 — evicts idle connections
    maxIdle:            5,                // keep up to 5 idle connections warm
  });

  // Pool-level error listener — prevents unhandled 'error' event crash.
  // Individual query errors are still thrown to callers normally.
  p.pool.on('error', (err) => {
    console.error(TAG, 'Pool error:', err.code, err.message);
    // Mark unhealthy — next ping will attempt recovery
    healthy = false;
  });

  return p;
}

// ── Startup with exponential backoff ──────────────────────────────────────────
async function initDB() {
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pool = createPool();
      // Validate with a real connection
      const conn = await pool.getConnection();
      conn.release();
      healthy = true;
      console.log(TAG, `MySQL connected (attempt ${attempt}/${MAX_RETRIES})`);
      startPing();
      return;
    } catch (err) {
      console.warn(TAG, `Connect attempt ${attempt}/${MAX_RETRIES} failed: ${err.code || err.message}`);
      // Destroy the failed pool before retrying
      if (pool) { try { await pool.end(); } catch {} }
      pool = null;
      healthy = false;

      if (attempt === MAX_RETRIES) {
        console.error(TAG, 'All connection attempts exhausted — starting WITHOUT database');
        // Don't crash — let /health report degraded so Docker can restart us
        return;
      }
      // Exponential backoff with jitter
      const jitter = Math.floor(Math.random() * 500);
      await sleep(Math.min(delay + jitter, MAX_DELAY_MS));
      delay *= 2;
    }
  }
}

// ── Periodic ping — detects dead connections and triggers reconnect ───────────
function startPing() {
  if (pingTimer) clearInterval(pingTimer);

  pingTimer = setInterval(async () => {
    if (!pool) {
      healthy = false;
      return attemptReconnect();
    }
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      if (!healthy) console.log(TAG, 'Connection restored');
      healthy = true;
    } catch (err) {
      console.warn(TAG, 'Ping failed:', err.code || err.message);
      healthy = false;
      attemptReconnect();
    }
  }, PING_INTERVAL_MS);

  // Don't prevent Node from exiting
  if (pingTimer.unref) pingTimer.unref();
}

async function attemptReconnect() {
  console.log(TAG, 'Attempting reconnect...');
  try {
    if (pool) { try { await pool.end(); } catch {} }
    pool = createPool();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    healthy = true;
    console.log(TAG, 'Reconnected successfully');
  } catch (err) {
    console.error(TAG, 'Reconnect failed:', err.code || err.message);
    healthy = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function getDB() {
  if (!pool) throw new Error('DB not initialized — pool is null');
  return pool;
}

/** True when the pool has a validated connection */
function isHealthy() {
  return healthy && pool !== null;
}

/** On-demand deep check — actually pings MySQL (used by /health) */
async function deepCheck() {
  if (!pool) return { ok: false, error: 'pool_null' };
  const t = Date.now();
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    healthy = true;
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    healthy = false;
    return { ok: false, error: err.code || err.message, ms: Date.now() - t };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { initDB, getDB, isHealthy, deepCheck };
