const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

// ── Auth middleware ───────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── GET /identity/me ──────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT grudge_id, username, puter_id, discord_id, discord_tag,
              wallet_address, server_wallet_address, faction, race, class,
              is_active, created_at, last_login
       FROM users WHERE grudge_id = ? LIMIT 1`,
      [req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /identity/me ────────────────────────
// Update username, faction, race, class
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['username', 'faction', 'race', 'class'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const db = getDB();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE users SET ${setClauses} WHERE grudge_id = ?`,
      [...Object.values(updates), req.user.grudge_id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /identity/:grudge_id ──────────────────
// Public profile lookup
router.get('/:grudge_id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT grudge_id, username, puter_id, faction, race, class, created_at
       FROM users WHERE grudge_id = ? AND is_active = 1 LIMIT 1`,
      [req.params.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
