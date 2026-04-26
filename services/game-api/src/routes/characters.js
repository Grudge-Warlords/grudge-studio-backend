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
    if (typeof name !== 'string' || name.length < 2 || name.length > 32) {
      return res.status(400).json({ error: 'Character name must be 2-32 characters' });
    }
    if (!/^[\w\s'-]+$/.test(name)) {
      return res.status(400).json({ error: 'Character name contains invalid characters' });
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
    // Validate coordinates are finite numbers within reasonable world bounds
    const COORD_MAX = 1_000_000;
    for (const [name, val] of [['pos_x', pos_x], ['pos_y', pos_y], ['pos_z', pos_z]]) {
      if (val !== undefined && val !== null) {
        const n = Number(val);
        if (!isFinite(n) || n < -COORD_MAX || n > COORD_MAX) {
          return res.status(400).json({ error: `${name} out of range` });
        }
      }
    }
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
// This endpoint is restricted to internal (game server) calls only.
router.patch('/:id/stats', async (req, res, next) => {
  try {
    if (!req.isInternal) {
      return res.status(403).json({ error: 'Stats may only be updated by the game server' });
    }
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
    // Verify all keys are from MUTABLE_STATS allowlist before interpolation
    const safeKeys = Object.keys(updates).filter(k => MUTABLE_STATS.includes(k));
    if (!safeKeys.length) {
      return res.status(400).json({ error: `No valid fields. Allowed: ${MUTABLE_STATS.join(', ')}` });
    }
    const setClauses = safeKeys.map(k => `${k} = ?`).join(', ');
    const [result] = await db.query(
      `UPDATE characters SET ${setClauses} WHERE id = ?`,
      [...safeKeys.map(k => updates[k]), req.params.id]
    );
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
