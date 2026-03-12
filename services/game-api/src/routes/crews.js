const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// ── GET /crews/mine ─────────────────────
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

// ── POST /crews ───────────────────────
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

// ── GET /crews/:id ──────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [crew] = await db.query('SELECT * FROM crews WHERE id = ?', [req.params.id]);
    if (!crew.length) return res.status(404).json({ error: 'Crew not found' });
    const [members] = await db.query(
      `SELECT cm.grudge_id, cm.role, cm.joined_at, u.username, u.faction
       FROM crew_members cm
       JOIN users u ON u.grudge_id = cm.grudge_id
       WHERE cm.crew_id = ?`,
      [req.params.id]
    );
    res.json({ ...crew[0], members });
  } catch (err) { next(err); }
});

// ── POST /crews/:id/join ─────────────────
router.post('/:id/join', async (req, res, next) => {
  try {
    const db = getDB();
    const [crew] = await db.query('SELECT * FROM crews WHERE id = ?', [req.params.id]);
    if (!crew.length) return res.status(404).json({ error: 'Crew not found' });
    // Max 5 human members (ai companions don't count toward cap)
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

// ── DELETE /crews/:id/leave ────────────────
router.delete('/:id/leave', async (req, res, next) => {
  try {
    const db = getDB();
    const [membership] = await db.query(
      'SELECT role FROM crew_members WHERE crew_id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!membership.length) return res.status(404).json({ error: 'Not a member of this crew' });
    if (membership[0].role === 'captain') {
      return res.status(400).json({ error: 'Captain cannot leave — transfer captaincy or disband crew first' });
    }
    await db.query(
      'DELETE FROM crew_members WHERE crew_id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PATCH /crews/:id/claim-base ─────────────
// Surviving crew captain plants a Pirate Claim flag on an island.
router.patch('/:id/claim-base', async (req, res, next) => {
  try {
    const { island } = req.body;
    if (!island) return res.status(400).json({ error: 'island required' });
    const db = getDB();
    const [membership] = await db.query(
      'SELECT role FROM crew_members WHERE crew_id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!membership.length) return res.status(403).json({ error: 'Not a member of this crew' });
    if (membership[0].role !== 'captain') {
      return res.status(403).json({ error: 'Only the captain can plant a Pirate Claim flag' });
    }
    await db.query('UPDATE crews SET base_island = ? WHERE id = ?', [island, req.params.id]);
    // Sync to island_state table
    await db.query(
      `INSERT INTO island_state (island_key, controlling_crew_id, claim_flag_planted_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE controlling_crew_id = VALUES(controlling_crew_id), claim_flag_planted_at = NOW()`,
      [island, req.params.id]
    );
    // Broadcast
    try {
      const redis = require('../redis').getRedis();
      if (redis) await redis.publish('grudge:event:island',
        JSON.stringify({ island, crew_id: req.params.id, event: 'claimed', ts: Date.now() }));
    } catch {}
    res.json({ success: true, base_island: island, message: `Pirate Claim flag planted on ${island}!` });
  } catch (err) { next(err); }
});

// ── PATCH /crews/:id/captain ──────────────
// Transfer captaincy to another member.
router.patch('/:id/captain', async (req, res, next) => {
  try {
    const { new_captain_grudge_id } = req.body;
    if (!new_captain_grudge_id) return res.status(400).json({ error: 'new_captain_grudge_id required' });
    const db = getDB();
    const [membership] = await db.query(
      'SELECT role FROM crew_members WHERE crew_id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!membership.length || membership[0].role !== 'captain') {
      return res.status(403).json({ error: 'Only the captain can transfer captaincy' });
    }
    // Demote current captain, promote new one
    await db.query(
      'UPDATE crew_members SET role = ? WHERE crew_id = ? AND grudge_id = ?',
      ['member', req.params.id, req.user.grudge_id]
    );
    await db.query(
      'UPDATE crew_members SET role = ? WHERE crew_id = ? AND grudge_id = ?',
      ['captain', req.params.id, new_captain_grudge_id]
    );
    res.json({ success: true, new_captain: new_captain_grudge_id });
  } catch (err) { next(err); }
});

module.exports = router;
