/**
 * GRUDGE STUDIO — Player Islands (Home Bases)
 * Mount: /player-islands
 * Migrated from grudge-wars Neon PostgreSQL → VPS MySQL
 *
 * Public (JWT):
 *   GET    /player-islands           — List player's islands
 *   GET    /player-islands/:id       — Get single island
 *   POST   /player-islands           — Create island
 *   PATCH  /player-islands/:id       — Update island data
 *   DELETE /player-islands/:id       — Delete island
 */

const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── GET / — List player's islands ────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM player_islands WHERE grudge_id = ? ORDER BY created_at DESC',
      [req.user.grudge_id]
    );
    res.json({ islands: rows });
  } catch (err) { next(err); }
});

// ── GET /:id — Single island ─────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[island]] = await db.query(
      'SELECT * FROM player_islands WHERE id = ? AND grudge_id = ? LIMIT 1',
      [req.params.id, req.user.grudge_id]
    );
    if (!island) return res.status(404).json({ error: 'Island not found' });
    res.json(island);
  } catch (err) { next(err); }
});

// ── POST / — Create island ───────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, zone_data, quest_progress, harvest_state } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const db = getDB();
    const [result] = await db.query(
      `INSERT INTO player_islands (grudge_id, name, zone_data, quest_progress, harvest_state)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.grudge_id, name,
       zone_data ? JSON.stringify(zone_data) : null,
       quest_progress ? JSON.stringify(quest_progress) : null,
       harvest_state ? JSON.stringify(harvest_state) : null]
    );
    res.status(201).json({ id: result.insertId, name });
  } catch (err) { next(err); }
});

// ── PATCH /:id — Update island ───────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[island]] = await db.query(
      'SELECT id FROM player_islands WHERE id = ? AND grudge_id = ? LIMIT 1',
      [req.params.id, req.user.grudge_id]
    );
    if (!island) return res.status(404).json({ error: 'Island not found' });

    const updates = [];
    const values = [];
    for (const field of ['name', 'zone_data', 'conquer_progress', 'quest_progress', 'unlocked_locations', 'harvest_state']) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(typeof req.body[field] === 'object' ? JSON.stringify(req.body[field]) : req.body[field]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    await db.query(`UPDATE player_islands SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [result] = await db.query(
      'DELETE FROM player_islands WHERE id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Island not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
