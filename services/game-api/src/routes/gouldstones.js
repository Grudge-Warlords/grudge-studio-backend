const express = require('express');
const router  = require('express').Router();
const axios   = require('axios');
const { getDB } = require('../db');

const MAX_GOULDSTONES  = 15;
const AI_AGENT_URL     = process.env.AI_AGENT_URL || 'http://ai-agent:3004';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// ── GET /gouldstones ──────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM gouldstones
       WHERE owner_grudge_id = ? AND is_active = TRUE
       ORDER BY created_at DESC`,
      [req.user.grudge_id]
    );
    res.json({ companions: rows, count: rows.length, max: MAX_GOULDSTONES });
  } catch (err) { next(err); }
});

// ── GET /gouldstones/:id ──────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM gouldstones WHERE id = ? AND owner_grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Gouldstone not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /gouldstones — Clone character as a Gouldstone ───────
// Body: { char_id, name?, source?, style? }
// Snapshots stats, equipped gear, and profession levels at this moment.
router.post('/', async (req, res, next) => {
  try {
    const { char_id, name, source = 'vendor', style = 'balanced' } = req.body;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });

    const db = getDB();

    // ── Cap at 15 ────────────────────────────────────────────
    const [[{ c }]] = await db.query(
      'SELECT COUNT(*) AS c FROM gouldstones WHERE owner_grudge_id = ? AND is_active = TRUE',
      [req.user.grudge_id]
    );
    if (c >= MAX_GOULDSTONES) {
      return res.status(400).json({
        error: `Maximum ${MAX_GOULDSTONES} Gouldstone companions already deployed`,
      });
    }

    // ── Verify character ownership ────────────────────────────
    const [chars] = await db.query(
      'SELECT * FROM characters WHERE id = ? AND grudge_id = ?',
      [char_id, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });
    const char = chars[0];

    // ── Snapshot equipped gear ────────────────────────────────
    const [gear] = await db.query(
      'SELECT item_key, slot, tier, item_type FROM inventory WHERE char_id = ? AND equipped = TRUE',
      [char_id]
    );

    // ── Snapshot profession levels ────────────────────────────
    const [profs] = await db.query(
      'SELECT profession, level FROM profession_progress WHERE char_id = ?',
      [char_id]
    );
    // Fall back to characters table columns if profession_progress rows don't exist yet
    const profLevels = {
      mining:       char.mining_lvl      || 0,
      fishing:      char.fishing_lvl     || 0,
      woodcutting:  char.woodcutting_lvl || 0,
      farming:      char.farming_lvl     || 0,
      hunting:      char.hunting_lvl     || 0,
    };
    profs.forEach(p => { profLevels[p.profession] = p.level; });

    const stats = {
      hp:           char.hp,
      max_hp:       char.max_hp,
      strength:     char.strength,
      dexterity:    char.dexterity,
      intelligence: char.intelligence,
    };

    // ── Get behavior profile from ai-agent ────────────────────
    let behaviorProfile = style;
    try {
      await axios.post(
        `${AI_AGENT_URL}/ai/companion/assign`,
        { class: char.class, style, faction: char.faction, gouldstone_id: 'pending' },
        { headers: { 'x-internal-key': INTERNAL_API_KEY }, timeout: 3000 }
      );
      // Profile accepted; store the style key
    } catch {
      // ai-agent unavailable — default profile still valid
    }

    // ── Insert Gouldstone ─────────────────────────────────────
    const gouldName = name || `${char.name}'s GOULD`;
    const [result] = await db.query(
      `INSERT INTO gouldstones
         (owner_grudge_id, name, race, class, level,
          stats, gear, profession_levels, behavior_profile, faction, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.grudge_id, gouldName, char.race, char.class, char.level,
        JSON.stringify(stats),
        JSON.stringify(gear),
        JSON.stringify(profLevels),
        behaviorProfile, char.faction, source,
      ]
    );
    const [rows] = await db.query('SELECT * FROM gouldstones WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /gouldstones/:id/deploy — Deploy to an island ───────
router.patch('/:id/deploy', async (req, res, next) => {
  try {
    const { island } = req.body;
    if (!island) return res.status(400).json({ error: 'island required' });
    const db = getDB();
    const [result] = await db.query(
      'UPDATE gouldstones SET deployed_island = ? WHERE id = ? AND owner_grudge_id = ?',
      [island, req.params.id, req.user.grudge_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Gouldstone not found' });
    res.json({ success: true, deployed_island: island });
  } catch (err) { next(err); }
});

// ── DELETE /gouldstones/:id — Dismiss (soft delete) ───────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [result] = await db.query(
      'UPDATE gouldstones SET is_active = FALSE, deployed_island = NULL WHERE id = ? AND owner_grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Gouldstone not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
