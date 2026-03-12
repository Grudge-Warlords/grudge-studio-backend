const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── POST /combat/log — Internal only ─────────────────────────
// Called by grudge-headless after each combat encounter.
// Body: { attacker_grudge_id, defender_grudge_id?, defender_type,
//         island?, outcome, attacker_dmg_dealt?, defender_dmg_dealt?,
//         combat_data?, duration_ms? }
router.post('/log', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });

    const {
      attacker_grudge_id,
      defender_grudge_id = null,
      defender_type      = 'ai',
      island             = null,
      outcome,
      attacker_dmg_dealt = 0,
      defender_dmg_dealt = 0,
      combat_data        = null,
      duration_ms        = 0,
    } = req.body;

    if (!attacker_grudge_id || !outcome) {
      return res.status(400).json({ error: 'attacker_grudge_id and outcome required' });
    }
    const VALID_OUTCOMES = ['attacker_win', 'defender_win', 'draw'];
    if (!VALID_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be: ${VALID_OUTCOMES.join(', ')}` });
    }

    const db = getDB();

    const [result] = await db.query(
      `INSERT INTO combat_log
         (attacker_grudge_id, defender_grudge_id, defender_type, island, outcome,
          attacker_dmg_dealt, defender_dmg_dealt, combat_data, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attacker_grudge_id, defender_grudge_id, defender_type, island, outcome,
        attacker_dmg_dealt, defender_dmg_dealt,
        combat_data ? JSON.stringify(combat_data) : null,
        duration_ms,
      ]
    );

    // ── Achievement: first_kill ──────────────────────────────
    if (outcome === 'attacker_win') {
      try {
        const [[prev]] = await db.query(
          `SELECT COUNT(*) AS c FROM combat_log
           WHERE attacker_grudge_id = ? AND outcome = 'attacker_win' AND id != ?`,
          [attacker_grudge_id, result.insertId]
        );
        if (prev.c === 0) {
          await db.query(
            `INSERT IGNORE INTO user_achievements (grudge_id, achievement_key)
             VALUES (?, 'first_kill')`,
            [attacker_grudge_id]
          );
        }
      } catch {} // achievement failure never blocks the log
    }

    // ── Publish real-time combat event ───────────────────────
    try {
      const redis = require('../redis').getRedis();
      if (redis && island) {
        await redis.publish('grudge:event:combat', JSON.stringify({
          attacker_grudge_id,
          defender_grudge_id,
          outcome,
          island,
          ts: Date.now(),
        }));
      }
    } catch {}

    res.status(201).json({ id: result.insertId, logged: true });
  } catch (err) { next(err); }
});

// ── GET /combat/history?char_id=X ────────────────────────────
// Returns last 50 combats where this player was attacker or defender.
router.get('/history', async (req, res, next) => {
  try {
    const { char_id } = req.query;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });

    // Resolve grudge_id from char_id (ownership check)
    const db = getDB();
    const query = req.isInternal
      ? 'SELECT grudge_id FROM characters WHERE id = ? LIMIT 1'
      : 'SELECT grudge_id FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1';
    const params = req.isInternal
      ? [char_id]
      : [char_id, req.user.grudge_id];
    const [[char]] = await db.query(query, params);
    if (!char) return res.status(403).json({ error: 'Character not found' });

    const [rows] = await db.query(
      `SELECT * FROM combat_log
       WHERE attacker_grudge_id = ? OR defender_grudge_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      [char.grudge_id, char.grudge_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /combat/leaderboard?island=X&limit=10 ────────────────
// Top players on an island ranked by wins. Island optional.
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { island, limit = 10 } = req.query;
    const db = getDB();

    let sql = `
      SELECT cl.attacker_grudge_id AS grudge_id,
             u.username,
             u.faction,
             COUNT(*) AS wins,
             SUM(cl.attacker_dmg_dealt) AS total_damage
      FROM combat_log cl
      JOIN users u ON u.grudge_id = cl.attacker_grudge_id
      WHERE cl.outcome = 'attacker_win'
    `;
    const params = [];
    if (island) { sql += ' AND cl.island = ?'; params.push(island); }
    sql += ` GROUP BY cl.attacker_grudge_id, u.username, u.faction
             ORDER BY wins DESC, total_damage DESC
             LIMIT ?`;
    params.push(Math.min(Number(limit) || 10, 100));

    const [rows] = await db.query(sql, params);
    res.json({ island: island || 'all', leaderboard: rows });
  } catch (err) { next(err); }
});

module.exports = router;
