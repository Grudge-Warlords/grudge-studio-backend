const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// ── GET /factions/me ──────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT grudge_id, username, faction FROM users WHERE grudge_id = ?',
      [req.user.grudge_id]
    );
    res.json(rows[0] || {});
  } catch (err) { next(err); }
});

// ── PATCH /factions/me ────────────────────────
router.patch('/me', async (req, res, next) => {
  try {
    const { faction } = req.body;
    if (!faction) return res.status(400).json({ error: 'faction required' });
    const db = getDB();
    await db.query('UPDATE users SET faction = ? WHERE grudge_id = ?', [faction, req.user.grudge_id]);
    res.json({ success: true, faction });
  } catch (err) { next(err); }
});

module.exports = router;
