const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

const MISSION_TYPES = ['harvesting', 'fighting', 'sailing', 'competing'];

// ── GET /missions ─────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM missions WHERE grudge_id = ? ORDER BY started_at DESC LIMIT 50`,
      [req.user.grudge_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /missions ────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { title, type, reward_gold = 0, reward_xp = 0 } = req.body;
    if (!title || !type) return res.status(400).json({ error: 'title and type required' });
    if (!MISSION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MISSION_TYPES.join(', ')}` });
    }

    // Limit: max 4 active missions per day (one per type)
    const db = getDB();
    const [active] = await db.query(
      `SELECT COUNT(*) as count FROM missions
       WHERE grudge_id = ? AND type = ? AND status = 'active'
         AND DATE(started_at) = CURDATE()`,
      [req.user.grudge_id, type]
    );
    if (active[0].count >= 11) {
      return res.status(429).json({ error: 'Daily mission limit reached for this type' });
    }

    const [result] = await db.query(
      `INSERT INTO missions (grudge_id, title, type, reward_gold, reward_xp) VALUES (?, ?, ?, ?, ?)`,
      [req.user.grudge_id, title, type, reward_gold, reward_xp]
    );
    const [rows] = await db.query('SELECT * FROM missions WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /missions/:id/complete ──────────────
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM missions WHERE id = ? AND grudge_id = ? AND status = 'active'`,
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Active mission not found' });

    await db.query(
      `UPDATE missions SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    // Apply XP reward to character (first active character)
    if (rows[0].reward_xp > 0) {
      await db.query(
        `UPDATE characters SET level = GREATEST(level, 1) WHERE grudge_id = ? LIMIT 1`,
        [req.user.grudge_id]
      );
    }

    res.json({ success: true, reward_gold: rows[0].reward_gold, reward_xp: rows[0].reward_xp });
  } catch (err) { next(err); }
});

module.exports = router;
