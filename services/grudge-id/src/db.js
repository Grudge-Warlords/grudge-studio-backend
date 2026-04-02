/**
 * grudge-id/db.js — Resilient MySQL pool
 *
 * Same hardened pattern as game-api/db.js:
 *   - Exponential-backoff startup retry (survives MySQL slow boot in Docker)
 *   - TCP keepalive to prevent idle connection resets
 *   - Automatic stale-connection eviction
 *   - Periodic health ping every 30s
 *   - Pool-level error listener
 *   - isHealthy() / deepCheck() for /health endpoint
 */
const mysql = require('mysql2/promise');

const TAG = '[grudge-id:db]';

const MAX_RETRIES       = 15;
const INITIAL_DELAY_MS  = 1_000;
const MAX_DELAY_MS      = 30_000;
const PING_INTERVAL_MS  = 30_000;
const POOL_SIZE         = 15;
const IDLE_TIMEOUT_MS   = 60_000;
const CONNECT_TIMEOUT   = 10_000;

let pool = null;
let healthy = false;
let pingTimer = null;

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
    enableKeepAlive:    true,
    keepAliveInitialDelay: 30_000,
    idleTimeout:        IDLE_TIMEOUT_MS,
    maxIdle:            5,
  });

  p.pool.on('error', (err) => {
    console.error(TAG, 'Pool error:', err.code, err.message);
    healthy = false;
  });

  return p;
}

async function initDB() {
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pool = createPool();
      const conn = await pool.getConnection();
      conn.release();
      healthy = true;
      console.log(TAG, `MySQL connected (attempt ${attempt}/${MAX_RETRIES})`);
      startPing();
      return;
    } catch (err) {
      console.warn(TAG, `Connect attempt ${attempt}/${MAX_RETRIES} failed: ${err.code || err.message}`);
      if (pool) { try { await pool.end(); } catch {} }
      pool = null;
      healthy = false;

      if (attempt === MAX_RETRIES) {
        console.error(TAG, 'All connection attempts exhausted — starting WITHOUT database');
        return;
      }
      const jitter = Math.floor(Math.random() * 500);
      await sleep(Math.min(delay + jitter, MAX_DELAY_MS));
      delay *= 2;
    }
  }
}

function startPing() {
  if (pingTimer) clearInterval(pingTimer);

  pingTimer = setInterval(async () => {
    if (!pool) { healthy = false; return attemptReconnect(); }
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

function getDB() {
  if (!pool) throw new Error('DB not initialized — pool is null');
  return pool;
}

function isHealthy() {
  return healthy && pool !== null;
}

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

function getPool() { return pool; }

module.exports = { initDB, getDB, getPool, isHealthy, deepCheck };
