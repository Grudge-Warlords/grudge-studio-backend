const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// Known factions — custom faction names are allowed but these are the canonical ones
const KNOWN_FACTIONS = ['pirate', 'undead', 'elven', 'orcish'];

// ── GET /factions/me ────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT grudge_id, username, faction, race, class FROM users WHERE grudge_id = ?',
      [req.user.grudge_id]
    );
    res.json(rows[0] || {});
  } catch (err) { next(err); }
});

// ── PATCH /factions/me ──────────────────
router.patch('/me', async (req, res, next) => {
  try {
    const { faction } = req.body;
    if (!faction) return res.status(400).json({ error: 'faction required' });
    const normalized = faction.toLowerCase().trim();
    if (normalized.length > 32) return res.status(400).json({ error: 'faction name too long (max 32)' });
    const db = getDB();
    await db.query(
      'UPDATE users SET faction = ? WHERE grudge_id = ?',
      [normalized, req.user.grudge_id]
    );
    res.json({ success: true, faction: normalized, is_canonical: KNOWN_FACTIONS.includes(normalized) });
  } catch (err) { next(err); }
});

// ── GET /factions/leaderboard ─────────────
router.get('/leaderboard', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT u.faction,
              COUNT(DISTINCT u.grudge_id)        AS members,
              COUNT(DISTINCT c.id)               AS crews,
              COALESCE(SUM(m.reward_gold), 0)    AS total_gold_earned,
              COUNT(CASE WHEN m.status = 'completed' THEN 1 END) AS missions_won
       FROM users u
       LEFT JOIN crews c ON c.faction = u.faction
       LEFT JOIN missions m ON m.grudge_id = u.grudge_id AND m.status = 'completed'
       WHERE u.faction IS NOT NULL
       GROUP BY u.faction
       ORDER BY missions_won DESC, total_gold_earned DESC
       LIMIT 20`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /factions/list ───────────────────
router.get('/list', (req, res) => {
  res.json({ factions: KNOWN_FACTIONS });
});

module.exports = router;
