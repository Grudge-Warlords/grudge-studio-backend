/**
 * GRUDGE STUDIO — Admin Dashboard API
 * Mount: /admin
 *
 * All routes require both:
 *   - Valid JWT with role 'admin' or 'owner'
 *   - OR x-internal-key header
 *
 * Provides: DB introspection, aggregate stats, container management (via Bridge),
 * storage info, and PvP server pool status.
 */

const express = require('express');
const router  = express.Router();
const { getDB }    = require('../db');
const { getRedis } = require('../redis');
const serverManager = require('../pvp-server-manager');

const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_KEY = process.env.BRIDGE_API_KEY || '';
const ASSET_SERVICE_URL = process.env.ASSET_SERVICE_URL || 'http://asset-service:3008';
const ACCOUNT_API_URL = process.env.ACCOUNT_API_URL || 'http://account-api:3005';
const IDENTITY_API_URL = process.env.IDENTITY_API_URL || 'http://grudge-id:3001';

// ── Admin-only middleware ────────────────────────────────────────
// Rejects non-admin JWT holders. Internal key always passes.
router.use((req, res, next) => {
  if (req.isInternal) return next();
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const role = req.user.role || req.user.roles?.[0] || 'player';
  if (!['admin', 'master'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// ── Helpers ──────────────────────────────────────────────────────

async function bridgeFetch(path, method = 'GET', body) {
  if (!BRIDGE_URL || !BRIDGE_KEY) return null;
  const opts = {
    method,
    headers: { Authorization: `Bearer ${BRIDGE_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BRIDGE_URL}/api/bridge${path}`, opts);
  if (!r.ok) throw new Error(`Bridge ${r.status}`);
  return r.json();
}

// ═══════════════════════════════════════════════════════════════
// DATABASE INTROSPECTION
// ═══════════════════════════════════════════════════════════════

// GET /admin/db/tables — list all tables with row counts and sizes
router.get('/db/tables', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT TABLE_NAME AS name,
             TABLE_ROWS AS \`rows\`,
             ROUND(DATA_LENGTH / 1024, 1) AS size_kb,
             ENGINE AS engine,
             UPDATE_TIME AS updated_at
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /admin/db/tables/:table — paginated table data
router.get('/db/tables/:table', async (req, res, next) => {
  try {
    const db = getDB();
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g, ''); // sanitize
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    // Verify table exists
    const [[exists]] = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    if (!exists) return res.status(404).json({ error: 'Table not found' });

    const [rows] = await db.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [limit, offset]);
    const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    res.json({ table, rows, total: cnt, limit, offset });
  } catch (e) { next(e); }
});

// GET /admin/db/schema/:table — column definitions
router.get('/db/schema/:table', async (req, res, next) => {
  try {
    const db = getDB();
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
    const [cols] = await db.query(`
      SELECT COLUMN_NAME AS name,
             DATA_TYPE AS type,
             COLUMN_TYPE AS full_type,
             IS_NULLABLE AS nullable,
             COLUMN_KEY AS \`key\`,
             COLUMN_DEFAULT AS \`default\`,
             EXTRA AS extra
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [table]);
    res.json({ table, columns: cols });
  } catch (e) { next(e); }
});

// POST /admin/db/query — execute read-only SQL (SELECT only, master role only)
router.post('/db/query', async (req, res, next) => {
  try {
    // Restrict raw SQL execution to master role
    if (!req.isInternal) {
      const role = req.user?.role || 'player';
      if (role !== 'master') {
        return res.status(403).json({ error: 'Raw SQL requires master role' });
      }
    }

    const { sql } = req.body;
    if (!sql) return res.status(400).json({ error: 'sql required' });

    // Only allow SELECT statements
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('DESCRIBE') && !trimmed.startsWith('EXPLAIN')) {
      return res.status(403).json({ error: 'Only SELECT / SHOW / DESCRIBE / EXPLAIN queries allowed' });
    }

    const db = getDB();
    const [rows] = await db.query(sql);
    res.json({ rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ error: 'Query failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// AGGREGATE STATS
// ═══════════════════════════════════════════════════════════════

router.get('/stats', async (req, res, next) => {
  try {
    const db = getDB();
    const redis = getRedis();

    const [[users]]    = await db.query('SELECT COUNT(*) AS count FROM users');
    const [[chars]]    = await db.query('SELECT COUNT(*) AS count FROM characters');
    const [[missions]] = await db.query('SELECT COUNT(*) AS count FROM missions WHERE status = ?', ['completed']);
    const [[lobbies]]  = await db.query("SELECT COUNT(*) AS count FROM pvp_lobbies WHERE status = 'in_progress'");
    const [[matches]]  = await db.query('SELECT COUNT(*) AS count FROM pvp_matches');

    let goldCirculating = 0;
    try {
      const [[g]] = await db.query('SELECT COALESCE(SUM(gold), 0) AS total FROM characters');
      goldCirculating = g?.total || 0;
    } catch {}

    let redisKeys = 0;
    try { redisKeys = await redis.dbsize(); } catch {}

    res.json({
      total_accounts: users?.count || 0,
      total_characters: chars?.count || 0,
      total_missions_completed: missions?.count || 0,
      active_pvp_lobbies: lobbies?.count || 0,
      total_pvp_matches: matches?.count || 0,
      gold_circulating: goldCirculating,
      redis_keys: redisKeys,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════
// CONTAINER MANAGEMENT (via Bridge proxy)
// ═══════════════════════════════════════════════════════════════

router.get('/containers', async (req, res) => {
  try {
    const data = await bridgeFetch('/health');
    if (!data) return res.json([]);
    // Bridge health returns container info — adapt as needed
    res.json(data.containers || data.services || [data]);
  } catch (e) {
    res.status(502).json({ error: 'Bridge unreachable', detail: e.message });
  }
});

router.post('/containers/:id/restart', async (req, res) => {
  try {
    const serviceId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!serviceId) return res.status(400).json({ error: 'Invalid service id' });
    const data = await bridgeFetch('/deploy', 'POST', { action: 'restart', service: serviceId });
    res.json(data || { ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Bridge unreachable', detail: e.message });
  }
});

router.get('/containers/:id/logs', async (req, res) => {
  try {
    const serviceId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!serviceId) return res.status(400).json({ error: 'Invalid service id' });
    const lines = Number(req.query.lines) || 100;
    const data = await bridgeFetch(`/deploy?service=${serviceId}&lines=${lines}`);
    res.json(data || { logs: '' });
  } catch (e) {
    res.status(502).json({ error: 'Bridge unreachable', detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STORAGE (via asset-service)
// ═══════════════════════════════════════════════════════════════

router.get('/storage/buckets', async (req, res) => {
  try {
    const r = await fetch(`${ASSET_SERVICE_URL}/storage/stats`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`Asset service ${r.status}`);
    res.json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'Asset service unreachable', detail: e.message });
  }
});

// ═════════════════════════════════════════════════════════════
// PVP SERVER POOL
// ═════════════════════════════════════════════════════════════

router.get('/pvp/servers', async (req, res, next) => {
  try {
    const servers = await serverManager.listServers();
    res.json({ servers });
  } catch (e) { next(e); }
});

// ═════════════════════════════════════════════════════════════
// ACCOUNT SERVICE PROXY (dashboard calls → account-api internal)
// ═════════════════════════════════════════════════════════════

async function proxyToService(serviceUrl, path, req, res) {
  try {
    const headers = { 'x-internal-key': process.env.INTERNAL_API_KEY, 'Content-Type': 'application/json' };
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    const r = await fetch(`${serviceUrl}${path}`, { headers, signal: AbortSignal.timeout(8000) });
    const data = await r.json().catch(() => null);
    res.status(r.status).json(data || { error: 'Empty response' });
  } catch (e) {
    res.status(502).json({ error: 'Service unreachable', detail: e.message });
  }
}

// Account list (all users from DB)
router.get('/accounts', async (req, res, next) => {
  try {
    const db = getDB();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [rows] = await db.query(
      `SELECT grudge_id, username, email, display_name, wallet_address, role, is_premium, is_banned, created_at
       FROM users ORDER BY created_at DESC LIMIT ?`, [limit]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Account detail
router.get('/accounts/:grudgeId', async (req, res, next) => {
  try {
    const db = getDB();
    const [[user]] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [req.params.grudgeId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [chars] = await db.query('SELECT * FROM characters WHERE grudge_id = ?', [req.params.grudgeId]);
    res.json({ ...user, characters: chars });
  } catch (e) { next(e); }
});

// Active sessions (from DB active_sessions or users with recent activity)
router.get('/accounts/sessions', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT grudge_id, username, last_login, last_ip, role
       FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY last_login DESC LIMIT 50`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Audit log (from dash_events or a dedicated audit table)
router.get('/accounts/audit-log', async (req, res, next) => {
  try {
    const db = getDB();
    // Try audit_log table first, fall back to recent user activity
    try {
      const [rows] = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100');
      return res.json(rows);
    } catch {
      // No audit_log table — return recent logins as audit entries
      const [rows] = await db.query(
        `SELECT grudge_id AS user_id, 'login' AS action, last_login AS timestamp, last_ip AS ip_address, '' AS details
         FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 100`
      );
      return res.json(rows);
    }
  } catch (e) { next(e); }
});

// ═════════════════════════════════════════════════════════════
// AUTH PROXY (dashboard → grudge-id internal)
// ═════════════════════════════════════════════════════════════

router.get('/auth/verify', (req, res) => proxyToService(IDENTITY_API_URL, '/auth/verify', req, res));
router.get('/auth/user', (req, res) => proxyToService(IDENTITY_API_URL, '/auth/user', req, res));

// ═════════════════════════════════════════════════════════════
// ECONOMY PROXY (dashboard → game-api economy routes internal)
// ═════════════════════════════════════════════════════════════

router.get('/economy/summary', async (req, res, next) => {
  try {
    const db = getDB();
    const [[gold]] = await db.query('SELECT COALESCE(SUM(gold), 0) AS total FROM characters');
    const [[chars]] = await db.query('SELECT COUNT(*) AS count FROM characters');
    res.json({
      gold_circulating: gold?.total || 0,
      total_characters: chars?.count || 0,
    });
  } catch (e) { next(e); }
});

router.get('/economy/overview', async (req, res, next) => {
  try {
    const db = getDB();
    const [[gold]] = await db.query('SELECT COALESCE(SUM(gold), 0) AS total FROM characters');
    const [[richest]] = await db.query('SELECT name, gold FROM characters ORDER BY gold DESC LIMIT 1');
    const [[txCount]] = await db.query("SELECT COUNT(*) AS count FROM gold_transactions WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)").catch(() => [[{ count: 0 }]]);
    res.json({
      gold_circulating: gold?.total || 0,
      richest_character: richest || null,
      transactions_24h: txCount?.count || 0,
    });
  } catch (e) { next(e); }
});

router.get('/economy/balance', async (req, res, next) => {
  try {
    const db = getDB();
    const charId = req.query.char_id;
    if (!charId) return res.status(400).json({ error: 'char_id required' });
    const [[char]] = await db.query('SELECT gold FROM characters WHERE id = ?', [charId]);
    if (!char) return res.status(404).json({ error: 'Character not found' });
    res.json({ char_id: charId, gold: char.gold });
  } catch (e) { next(e); }
});

// ═════════════════════════════════════════════════════════════
// PVP LOBBIES ADMIN (all statuses visible to admin)
// ═════════════════════════════════════════════════════════════

router.get('/pvp/lobbies', async (req, res, next) => {
  try {
    const db = getDB();
    const { status, limit = 50 } = req.query;
    let sql = `
      SELECT pl.lobby_code, pl.mode, pl.island, pl.host_grudge_id, pl.status,
             pl.max_players, pl.created_at, pl.started_at, pl.finished_at,
             u.username AS host_username,
             COUNT(plp.grudge_id) AS player_count
      FROM pvp_lobbies pl
      LEFT JOIN users u ON u.grudge_id = pl.host_grudge_id
      LEFT JOIN pvp_lobby_players plp ON plp.lobby_id = pl.id
    `;
    const params = [];
    if (status) { sql += ' WHERE pl.status = ?'; params.push(status); }
    sql += ' GROUP BY pl.id ORDER BY pl.created_at DESC LIMIT ?';
    params.push(Math.min(Number(limit) || 50, 200));
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/pvp/lobbies/:code/cancel', async (req, res, next) => {
  try {
    const db = getDB();
    const { getRedis } = require('../redis');
    const [[lobby]] = await db.query(
      `SELECT id, status FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`,
      [req.params.code]
    );
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    if (['finished','cancelled'].includes(lobby.status))
      return res.status(409).json({ error: 'Lobby already ended' });
    await db.query(
      `UPDATE pvp_lobbies SET status = 'cancelled', finished_at = NOW() WHERE id = ?`,
      [lobby.id]
    );
    try {
      await getRedis().publish('grudge:event:pvp_lobby', JSON.stringify({
        event: 'cancelled', lobby_code: req.params.code, by: 'admin',
      }));
    } catch {}
    res.json({ ok: true, lobby_code: req.params.code });
  } catch (e) { next(e); }
});

// ═════════════════════════════════════════════════════════════
// DEPLOY HISTORY (from dash_events table)
// ═════════════════════════════════════════════════════════════

router.get('/deploy/history', async (req, res, next) => {
  try {
    const db = getDB();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const service = req.query.service || null;
    let sql = 'SELECT * FROM dash_events';
    const params = [];
    if (service) { sql += ' WHERE service = ?'; params.push(service); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Admin can log an event (used by deploy.sh / GitHub Actions webhook)
router.post('/deploy/event', async (req, res, next) => {
  try {
    const { event_type = 'deploy', service, status = 'ok', actor, commit_sha, details } = req.body;
    if (!service) return res.status(400).json({ error: 'service required' });
    const db = getDB();
    await db.query(
      'INSERT INTO dash_events (event_type, service, status, actor, commit_sha, details) VALUES (?, ?, ?, ?, ?, ?)',
      [event_type, service, status, actor || null, commit_sha || null, details || null]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
