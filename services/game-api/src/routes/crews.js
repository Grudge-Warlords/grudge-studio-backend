const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// ── GET /crews/mine ───────────────────────────
router.get('/mine', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT c.*, cm.role FROM crews c
       JOIN crew_members cm ON cm.crew_id = c.id
       WHERE cm.grudge_id = ?`,
      [req.user.grudge_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /crews ───────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, faction } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const db = getDB();
    const [result] = await db.query(
      'INSERT INTO crews (name, faction) VALUES (?, ?)',
      [name, faction || req.user.faction]
    );
    await db.query(
      'INSERT INTO crew_members (crew_id, grudge_id, role) VALUES (?, ?, ?)',
      [result.insertId, req.user.grudge_id, 'captain']
    );
    const [rows] = await db.query('SELECT * FROM crews WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /crews/:id/join ──────────────────────
router.post('/:id/join', async (req, res, next) => {
  try {
    const db = getDB();
    const [crew] = await db.query('SELECT * FROM crews WHERE id = ?', [req.params.id]);
    if (!crew.length) return res.status(404).json({ error: 'Crew not found' });

    // Max 5 members
    const [count] = await db.query(
      "SELECT COUNT(*) as c FROM crew_members WHERE crew_id = ? AND role != 'ai'",
      [req.params.id]
    );
    if (count[0].c >= 5) return res.status(400).json({ error: 'Crew is full (max 5)' });

    await db.query(
      'INSERT IGNORE INTO crew_members (crew_id, grudge_id, role) VALUES (?, ?, ?)',
      [req.params.id, req.user.grudge_id, 'member']
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
