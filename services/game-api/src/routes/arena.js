/**
 * GRUDGE STUDIO — Arena Routes
 * Mount: /arena
 * Migrated from grudge-wars Neon PostgreSQL → VPS MySQL
 *
 * Public (JWT):
 *   GET    /arena/teams           — Leaderboard (top teams by wins)
 *   GET    /arena/teams/:id       — Single team
 *   GET    /arena/my-teams        — Current user's teams
 *   POST   /arena/teams           — Create team
 *   PATCH  /arena/teams/:id       — Update team heroes
 *   DELETE /arena/teams/:id       — Delete team
 *   POST   /arena/battle          — Record battle result
 *   GET    /arena/battles/:teamId — Battle history for a team
 *   GET    /arena/stats           — Global arena stats
 */

const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');
const crypto  = require('crypto');

// ── GET /arena/teams — Leaderboard ───────────────────────────
router.get('/teams', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM arena_teams WHERE status = 'ranked'
       ORDER BY wins DESC, total_battles DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ teams: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── GET /arena/my-teams — Current user's teams ───────────────
router.get('/my-teams', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM arena_teams WHERE owner_id = ? ORDER BY updated_at DESC',
      [req.user.grudge_id]
    );
    res.json({ teams: rows });
  } catch (err) { next(err); }
});

// ── GET /arena/teams/:id — Single team ───────────────────────
router.get('/teams/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[team]] = await db.query(
      'SELECT * FROM arena_teams WHERE team_id = ? LIMIT 1',
      [req.params.id]
    );
    if (!team) return res.status(404).json({ error: 'Team not found' });
    res.json(team);
  } catch (err) { next(err); }
});

// ── POST /arena/teams — Create team ──────────────────────────
router.post('/teams', async (req, res, next) => {
  try {
    const { heroes = [] } = req.body;
    if (!Array.isArray(heroes) || heroes.length === 0) {
      return res.status(400).json({ error: 'heroes array required' });
    }

    const db = getDB();
    const grudge_id = req.user.grudge_id;
    const username = req.user.username || 'Unknown Warlord';

    // Generate team ID
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '');
    const hash = crypto.createHash('sha256').update(`${grudge_id}-${ts}-${Math.random()}`).digest('hex').slice(0, 8);
    const team_id = `ARENA-${ts}-${hash}`.toUpperCase();

    const avgLevel = heroes.length > 0
      ? Math.round(heroes.reduce((s, h) => s + (h.level || 1), 0) / heroes.length)
      : 1;

    const share_token = crypto.randomBytes(12).toString('hex');

    await db.query(
      `INSERT INTO arena_teams (team_id, owner_id, owner_name, heroes, hero_count, avg_level, share_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [team_id, grudge_id, username, JSON.stringify(heroes), heroes.length, avgLevel, share_token]
    );

    res.status(201).json({ team_id, share_token, hero_count: heroes.length, avg_level: avgLevel });
  } catch (err) { next(err); }
});

// ── PATCH /arena/teams/:id — Update team ─────────────────────
router.patch('/teams/:id', async (req, res, next) => {
  try {
    const { heroes } = req.body;
    if (!Array.isArray(heroes)) return res.status(400).json({ error: 'heroes array required' });

    const db = getDB();
    const [[team]] = await db.query(
      'SELECT owner_id FROM arena_teams WHERE team_id = ? LIMIT 1',
      [req.params.id]
    );
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.owner_id !== req.user.grudge_id) {
      return res.status(403).json({ error: 'Not your team' });
    }

    const avgLevel = heroes.length > 0
      ? Math.round(heroes.reduce((s, h) => s + (h.level || 1), 0) / heroes.length)
      : 1;

    await db.query(
      `UPDATE arena_teams SET heroes = ?, hero_count = ?, avg_level = ?, updated_at = NOW()
       WHERE team_id = ?`,
      [JSON.stringify(heroes), heroes.length, avgLevel, req.params.id]
    );

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /arena/teams/:id ──────────────────────────────────
router.delete('/teams/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[team]] = await db.query(
      'SELECT owner_id FROM arena_teams WHERE team_id = ? LIMIT 1',
      [req.params.id]
    );
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.owner_id !== req.user.grudge_id && !req.isInternal) {
      return res.status(403).json({ error: 'Not your team' });
    }
    await db.query('DELETE FROM arena_teams WHERE team_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /arena/battle — Record battle result ────────────────
router.post('/battle', async (req, res, next) => {
  try {
    const { team_id, challenger_name = 'Arena Challenger', result, battle_log } = req.body;
    if (!team_id || !result) {
      return res.status(400).json({ error: 'team_id and result required' });
    }
    if (!['win', 'loss', 'draw'].includes(result)) {
      return res.status(400).json({ error: 'result must be win, loss, or draw' });
    }

    const db = getDB();
    const [[team]] = await db.query(
      'SELECT owner_id FROM arena_teams WHERE team_id = ? LIMIT 1',
      [team_id]
    );
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.owner_id !== req.user.grudge_id && !req.isInternal) {
      return res.status(403).json({ error: 'Not your team' });
    }

    const battle_id = `BTL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex')}`;

    await db.query(
      `INSERT INTO arena_battles (battle_id, team_id, challenger_name, result, battle_log)
       VALUES (?, ?, ?, ?, ?)`,
      [battle_id, team_id, challenger_name, result, battle_log ? JSON.stringify(battle_log) : null]
    );

    // Update team stats
    const winInc = result === 'win' ? 1 : 0;
    const lossInc = result === 'loss' ? 1 : 0;
    await db.query(
      `UPDATE arena_teams
       SET wins = wins + ?, losses = losses + ?, total_battles = total_battles + 1, updated_at = NOW()
       WHERE team_id = ?`,
      [winInc, lossInc, team_id]
    );

    res.status(201).json({ battle_id, result });
  } catch (err) { next(err); }
});

// ── GET /arena/battles/:teamId — Battle history ──────────────
router.get('/battles/:teamId', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM arena_battles WHERE team_id = ? ORDER BY created_at DESC LIMIT ?',
      [req.params.teamId, limit]
    );
    res.json({ battles: rows });
  } catch (err) { next(err); }
});

// ── GET /arena/stats — Global arena stats ────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const db = getDB();
    const [[stats]] = await db.query(
      `SELECT
         COUNT(*) AS total_teams,
         SUM(total_battles) AS total_battles,
         MAX(wins) AS highest_wins
       FROM arena_teams WHERE status = 'ranked'`
    );
    const [[battleCount]] = await db.query('SELECT COUNT(*) AS cnt FROM arena_battles');
    res.json({
      total_teams: stats.total_teams || 0,
      total_battles: battleCount.cnt || 0,
      highest_wins: stats.highest_wins || 0,
    });
  } catch (err) { next(err); }
});

module.exports = router;
