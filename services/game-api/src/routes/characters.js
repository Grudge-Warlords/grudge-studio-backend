const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

const VALID_RACES = ['human', 'elf', 'worge', 'undead', 'orc'];
const VALID_CLASSES = ['warrior', 'mage', 'ranger', 'worge'];

// ── GET /characters ───────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM characters WHERE grudge_id = ?',
      [req.user.grudge_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /characters ──────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, race, class: cls } = req.body;
    if (!name || !race || !cls) {
      return res.status(400).json({ error: 'name, race, and class are required' });
    }
    if (!VALID_RACES.includes(race.toLowerCase())) {
      return res.status(400).json({ error: `Invalid race. Valid: ${VALID_RACES.join(', ')}` });
    }
    if (!VALID_CLASSES.includes(cls.toLowerCase())) {
      return res.status(400).json({ error: `Invalid class. Valid: ${VALID_CLASSES.join(', ')}` });
    }

    const db = getDB();
    const [result] = await db.query(
      `INSERT INTO characters (grudge_id, name, race, class, faction)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.grudge_id, name, race.toLowerCase(), cls.toLowerCase(), req.user.faction || null]
    );
    const [rows] = await db.query('SELECT * FROM characters WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /characters/:id ───────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM characters WHERE id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Character not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /characters/:id/position ───────────
router.patch('/:id/position', async (req, res, next) => {
  try {
    const { island, pos_x, pos_y, pos_z } = req.body;
    const db = getDB();
    await db.query(
      'UPDATE characters SET island = ?, pos_x = ?, pos_y = ?, pos_z = ? WHERE id = ? AND grudge_id = ?',
      [island, pos_x, pos_y, pos_z, req.params.id, req.user.grudge_id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
