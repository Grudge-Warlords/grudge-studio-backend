const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

const VALID_RACES   = ['human', 'orc', 'elf', 'undead', 'barbarian', 'dwarf'];
const VALID_CLASSES = ['warrior', 'mage', 'ranger', 'worge'];
// Numeric fields the game server may write back after combat/events
const MUTABLE_STATS = ['hp', 'max_hp', 'strength', 'dexterity', 'intelligence', 'level',
                       'mining_lvl', 'fishing_lvl', 'woodcutting_lvl', 'farming_lvl', 'hunting_lvl'];

// ── GET /characters ───────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    // Internal key: caller may pass grudge_id in query to lookup any player
    const grudgeId = req.isInternal
      ? (req.query.grudge_id || null)
      : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });
    const [rows] = await db.query(
      'SELECT * FROM characters WHERE grudge_id = ?',
      [grudgeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /characters ──────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (req.isInternal) return res.status(403).json({ error: 'Character creation requires player auth' });
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

// ── GET /characters/:id ───────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const query = req.isInternal
      ? 'SELECT * FROM characters WHERE id = ?'
      : 'SELECT * FROM characters WHERE id = ? AND grudge_id = ?';
    const params = req.isInternal
      ? [req.params.id]
      : [req.params.id, req.user.grudge_id];
    const [rows] = await db.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Character not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /characters/:id/position ───────────
router.patch('/:id/position', async (req, res, next) => {
  try {
    const { island, pos_x, pos_y, pos_z } = req.body;
    const db = getDB();
    const query = req.isInternal
      ? 'UPDATE characters SET island = ?, pos_x = ?, pos_y = ?, pos_z = ? WHERE id = ?'
      : 'UPDATE characters SET island = ?, pos_x = ?, pos_y = ?, pos_z = ? WHERE id = ? AND grudge_id = ?';
    const params = req.isInternal
      ? [island, pos_x, pos_y, pos_z, req.params.id]
      : [island, pos_x, pos_y, pos_z, req.params.id, req.user.grudge_id];
    await db.query(query, params);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PATCH /characters/:id/stats ─────────────
// Game server uses x-internal-key to write back HP/XP/stats after combat.
// Players can also update their own character's mutable stats.
router.patch('/:id/stats', async (req, res, next) => {
  try {
    const updates = {};
    for (const field of MUTABLE_STATS) {
      if (req.body[field] !== undefined) {
        const val = Number(req.body[field]);
        if (!isNaN(val) && val >= 0) updates[field] = val;
      }
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: `No valid fields. Allowed: ${MUTABLE_STATS.join(', ')}` });
    }
    const db = getDB();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const query = req.isInternal
      ? `UPDATE characters SET ${setClauses} WHERE id = ?`
      : `UPDATE characters SET ${setClauses} WHERE id = ? AND grudge_id = ?`;
    const params = req.isInternal
      ? [...Object.values(updates), req.params.id]
      : [...Object.values(updates), req.params.id, req.user.grudge_id];
    const [result] = await db.query(query, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Character not found' });
    res.json({ success: true, updated: updates });
  } catch (err) { next(err); }
});

// ── DELETE /characters/:id ──────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.isInternal) return res.status(403).json({ error: 'Character deletion requires player auth' });
    const db = getDB();
    const [result] = await db.query(
      'DELETE FROM characters WHERE id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Character not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
