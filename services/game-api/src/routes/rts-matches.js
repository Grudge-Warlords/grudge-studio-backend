/**
 * RTS Match Routes — Match history & leaderboards for Gruda Armada
 *
 * POST   /rts-matches              → record a completed match
 * GET    /rts-matches/leaderboard  → top players by wins
 * GET    /rts-matches/history      → current user's match history
 * GET    /rts-matches/:id          → single match detail
 */

const { Router } = require('express');
const { getRedis } = require('../redis');

const router = Router();
const LB_CACHE_KEY = 'rts:leaderboard';
const LB_CACHE_TTL = 120; // 2 min

// ── POST /rts-matches — record completed match ───────────────────
router.post('/', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const { winner_grudge_id, loser_grudge_id, mode, duration_s, map_seed, stats } = req.body;
    if (!winner_grudge_id || !mode) {
      return res.status(400).json({ error: 'winner_grudge_id and mode required' });
    }

    const db = require('../db').getDB();
    const [result] = await db.query(
      `INSERT INTO rts_matches (winner_grudge_id, loser_grudge_id, mode, duration_s, map_seed, stats_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        winner_grudge_id,
        loser_grudge_id || null,
        mode,
        duration_s || 0,
        map_seed || null,
        stats ? JSON.stringify(stats) : null,
      ]
    );

    // Invalidate leaderboard cache
    const redis = getRedis();
    await redis.del(LB_CACHE_KEY);

    res.json({ ok: true, matchId: result.insertId });
  } catch (err) { next(err); }
});

// ── GET /rts-matches/leaderboard ─────────────────────────────────
router.get('/leaderboard', async (req, res, next) => {
  try {
    const redis = getRedis();
    const cached = await redis.get(LB_CACHE_KEY);
    if (cached) {
      return res.json({ success: true, cached: true, leaderboard: JSON.parse(cached) });
    }

    const db = require('../db').getDB();
    const [rows] = await db.query(
      `SELECT
         winner_grudge_id AS grudge_id,
         COUNT(*) AS wins,
         ROUND(AVG(duration_s)) AS avg_duration_s
       FROM rts_matches
       WHERE winner_grudge_id IS NOT NULL
       GROUP BY winner_grudge_id
       ORDER BY wins DESC
       LIMIT 50`
    );

    // Try to enrich with usernames
    if (rows.length) {
      const ids = rows.map(r => r.grudge_id);
      const placeholders = ids.map(() => '?').join(',');
      const [users] = await db.query(
        `SELECT grudge_id, username, display_name, avatar_url FROM users WHERE grudge_id IN (${placeholders})`,
        ids
      );
      const userMap = Object.fromEntries(users.map(u => [u.grudge_id, u]));
      for (const row of rows) {
        const u = userMap[row.grudge_id];
        row.username = u?.display_name || u?.username || 'Commander';
        row.avatarUrl = u?.avatar_url || null;
      }
    }

    await redis.set(LB_CACHE_KEY, JSON.stringify(rows), 'EX', LB_CACHE_TTL);
    res.json({ success: true, cached: false, leaderboard: rows });
  } catch (err) { next(err); }
});

// ── GET /rts-matches/history ─────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const db = require('../db').getDB();
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM rts_matches
       WHERE winner_grudge_id = ? OR loser_grudge_id = ?`,
      [grudgeId, grudgeId]
    );
    const [rows] = await db.query(
      `SELECT id, winner_grudge_id, loser_grudge_id, mode, duration_s, map_seed, stats_json, created_at
       FROM rts_matches
       WHERE winner_grudge_id = ? OR loser_grudge_id = ?
       ORDER BY created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      [grudgeId, grudgeId]
    );

    for (const row of rows) {
      row.won = row.winner_grudge_id === grudgeId;
      if (row.stats_json && typeof row.stats_json === 'string') {
        row.stats = JSON.parse(row.stats_json);
      }
      delete row.stats_json;
    }

    res.json({ total, page, limit, matches: rows });
  } catch (err) { next(err); }
});

// ── GET /rts-matches/:id ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = require('../db').getDB();
    const [[row]] = await db.query(
      `SELECT id, winner_grudge_id, loser_grudge_id, mode, duration_s, map_seed, stats_json, created_at
       FROM rts_matches WHERE id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Match not found' });
    if (row.stats_json && typeof row.stats_json === 'string') {
      row.stats = JSON.parse(row.stats_json);
    }
    delete row.stats_json;
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
