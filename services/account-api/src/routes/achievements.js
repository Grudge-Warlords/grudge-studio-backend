const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth, requireInternal } = require('../middleware/auth');

// ── GET /achievements/defs ────────────────────────────────────────
// Public — list all achievement definitions.
router.get('/defs', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT id, ach_key, name, description, icon_url, points FROM achievements_def ORDER BY points ASC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /achievements/mine ────────────────────────────────────────
// Auth required — returns earned achievements for current user with def info.
router.get('/mine', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT d.ach_key, d.name, d.description, d.icon_url, d.points, ua.earned_at
       FROM user_achievements ua
       JOIN achievements_def d ON d.ach_key = ua.achievement_key
       WHERE ua.grudge_id = ?
       ORDER BY ua.earned_at DESC`,
      [me]
    );
    const total_points = rows.reduce((sum, r) => sum + r.points, 0);
    res.json({ total_points, achievements: rows });
  } catch (err) {
    next(err);
  }
});

// ── GET /achievements/:grudge_id ──────────────────────────────────
// Public — view another user's achievements.
router.get('/:grudge_id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT d.ach_key, d.name, d.description, d.icon_url, d.points, ua.earned_at
       FROM user_achievements ua
       JOIN achievements_def d ON d.ach_key = ua.achievement_key
       WHERE ua.grudge_id = ?
       ORDER BY ua.earned_at DESC`,
      [req.params.grudge_id]
    );
    const total_points = rows.reduce((sum, r) => sum + r.points, 0);
    res.json({ total_points, achievements: rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /achievements/award — internal only ──────────────────────
// Called by game-api / ai-agent when a player earns an achievement.
// Idempotent — silently ignores if already earned.
// Body: { grudge_id, achievement_key }
// Optionally posts a notification to account-api as well.
router.post('/award', requireInternal, async (req, res, next) => {
  const { grudge_id, achievement_key } = req.body;
  if (!grudge_id || !achievement_key) {
    return res.status(400).json({ error: 'grudge_id and achievement_key are required' });
  }
  try {
    const db = getDB();

    // Verify the achievement def exists
    const [[def]] = await db.query(
      'SELECT ach_key, name, points FROM achievements_def WHERE ach_key = ?',
      [achievement_key]
    );
    if (!def) return res.status(404).json({ error: `Achievement '${achievement_key}' not defined` });

    // INSERT IGNORE — idempotent
    const [result] = await db.query(
      'INSERT IGNORE INTO user_achievements (grudge_id, achievement_key) VALUES (?, ?)',
      [grudge_id, achievement_key]
    );

    if (result.affectedRows > 0) {
      // Push a notification (best-effort)
      await db.query(
        `INSERT INTO notifications (grudge_id, type, payload) VALUES (?, 'achievement', ?)`,
        [grudge_id, JSON.stringify({ key: achievement_key, name: def.name, points: def.points })]
      ).catch(() => {/* swallow — notifications are not critical */});
    }

    res.json({ ok: true, awarded: result.affectedRows > 0, achievement: def });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
