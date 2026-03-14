const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── GET /dungeon/heroes — All MOBA heroes ────────────────────
router.get('/heroes', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query('SELECT * FROM moba_heroes ORDER BY id');
    // Map DB columns to camelCase for frontend compatibility
    const heroes = rows.map(r => ({
      id: r.id,
      name: r.name,
      title: r.title,
      race: r.race,
      heroClass: r.hero_class,
      faction: r.faction,
      rarity: r.rarity,
      hp: r.hp,
      atk: r.atk,
      def: r.def,
      spd: r.spd,
      rng: parseFloat(r.rng),
      mp: r.mp,
      quote: r.quote,
      isSecret: !!r.is_secret,
    }));
    res.json(heroes);
  } catch (err) { next(err); }
});

// ── GET /dungeon/heroes/:id — Single hero ────────────────────
router.get('/heroes/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[row]] = await db.query('SELECT * FROM moba_heroes WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Hero not found' });
    res.json({
      id: row.id,
      name: row.name,
      title: row.title,
      race: row.race,
      heroClass: row.hero_class,
      faction: row.faction,
      rarity: row.rarity,
      hp: row.hp,
      atk: row.atk,
      def: row.def,
      spd: row.spd,
      rng: parseFloat(row.rng),
      mp: row.mp,
      quote: row.quote,
      isSecret: !!row.is_secret,
    });
  } catch (err) { next(err); }
});

// ── GET /dungeon/abilities/:class — Abilities by class ───────
// Accepts: Warrior, Mage, Ranger, Worg, Orc_Warrior, Elf_Warrior
router.get('/abilities/:class', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM moba_abilities WHERE ability_class = ? ORDER BY FIELD(hotkey, "Q","W","E","R")',
      [req.params.class]
    );
    if (!rows.length) return res.status(404).json({ error: 'Class not found' });
    const abilities = rows.map(r => ({
      name: r.name,
      key: r.hotkey,
      cooldown: parseFloat(r.cooldown),
      manaCost: r.mana_cost,
      damage: r.damage,
      range: r.ability_range,
      radius: r.radius,
      duration: parseFloat(r.duration),
      type: r.ability_type,
      castType: r.cast_type,
      description: r.description,
      maxCharges: r.max_charges || undefined,
      chargeRechargeTime: r.charge_recharge ? parseFloat(r.charge_recharge) : undefined,
    }));
    res.json(abilities);
  } catch (err) { next(err); }
});

// ── GET /dungeon/items — All MOBA items ──────────────────────
router.get('/items', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query('SELECT * FROM moba_items ORDER BY tier, id');
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /dungeon/runs — Log a dungeon run ───────────────────
router.post('/runs', async (req, res, next) => {
  try {
    const grudgeId = req.isInternal
      ? (req.body.grudge_id || null)
      : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });

    const {
      hero_id,
      hero_name,
      hero_class,
      floors_reached = 1,
      kills = 0,
      gold_earned = 0,
      duration_ms = 0,
      outcome = 'died',
      run_data = null,
    } = req.body;

    if (!hero_name || !hero_class) {
      return res.status(400).json({ error: 'hero_name and hero_class required' });
    }
    const VALID_OUTCOMES = ['cleared', 'died', 'abandoned'];
    if (!VALID_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be: ${VALID_OUTCOMES.join(', ')}` });
    }

    const db = getDB();
    const [result] = await db.query(
      `INSERT INTO dungeon_runs
         (grudge_id, hero_id, hero_name, hero_class, floors_reached, kills, gold_earned, duration_ms, outcome, run_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [grudgeId, hero_id || 0, hero_name, hero_class, floors_reached, kills, gold_earned, duration_ms, outcome,
       run_data ? JSON.stringify(run_data) : null]
    );

    // ── Achievement: first_dungeon_clear ──────────────────────
    if (outcome === 'cleared') {
      try {
        const [[prev]] = await db.query(
          `SELECT COUNT(*) AS c FROM dungeon_runs
           WHERE grudge_id = ? AND outcome = 'cleared' AND id != ?`,
          [grudgeId, result.insertId]
        );
        if (prev.c === 0) {
          await db.query(
            `INSERT IGNORE INTO user_achievements (grudge_id, achievement_key)
             VALUES (?, 'first_dungeon_clear')`,
            [grudgeId]
          );
        }
      } catch {} // achievement failure never blocks the log
    }

    res.status(201).json({ id: result.insertId, logged: true });
  } catch (err) { next(err); }
});

// ── GET /dungeon/runs — Player's dungeon run history ─────────
router.get('/runs', async (req, res, next) => {
  try {
    const grudgeId = req.isInternal
      ? (req.query.grudge_id || null)
      : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });

    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM dungeon_runs WHERE grudge_id = ? ORDER BY created_at DESC LIMIT 50',
      [grudgeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /dungeon/results — Log a MOBA match result ──────────
router.post('/results', async (req, res, next) => {
  try {
    const grudgeId = req.isInternal
      ? (req.body.grudge_id || null)
      : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });

    const {
      hero: heroName,
      heroClass,
      kills = 0,
      deaths = 0,
      assists = 0,
      duration = 0,
      win = false,
      match_data = null,
    } = req.body;

    if (!heroName || !heroClass) {
      return res.status(400).json({ error: 'hero and heroClass required' });
    }

    const db = getDB();
    const [result] = await db.query(
      `INSERT INTO moba_match_results
         (grudge_id, hero_name, hero_class, kills, deaths, assists, duration_ms, win, match_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [grudgeId, heroName, heroClass, kills, deaths, assists,
       Math.round(duration * 1000), win,
       match_data ? JSON.stringify(match_data) : null]
    );

    res.status(201).json({ id: result.insertId, logged: true });
  } catch (err) { next(err); }
});

// ── GET /dungeon/results — Match result history ──────────────
router.get('/results', async (req, res, next) => {
  try {
    const grudgeId = req.isInternal
      ? (req.query.grudge_id || null)
      : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });

    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM moba_match_results WHERE grudge_id = ? ORDER BY created_at DESC LIMIT 50',
      [grudgeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /dungeon/leaderboard — Top dungeon players ───────────
// ?type=dungeon (default) or ?type=moba&limit=10
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { type = 'dungeon', limit = 10 } = req.query;
    const db = getDB();
    const safeLimit = Math.min(Number(limit) || 10, 100);

    if (type === 'moba') {
      const [rows] = await db.query(
        `SELECT m.grudge_id, u.username, u.faction,
                COUNT(CASE WHEN m.win THEN 1 END) AS wins,
                COUNT(*) AS total_games,
                SUM(m.kills) AS total_kills,
                SUM(m.deaths) AS total_deaths
         FROM moba_match_results m
         JOIN users u ON u.grudge_id = m.grudge_id
         GROUP BY m.grudge_id, u.username, u.faction
         ORDER BY wins DESC, total_kills DESC
         LIMIT ?`,
        [safeLimit]
      );
      return res.json({ type: 'moba', leaderboard: rows });
    }

    // Default: dungeon leaderboard (highest floor reached)
    const [rows] = await db.query(
      `SELECT d.grudge_id, u.username, u.faction,
              MAX(d.floors_reached) AS best_floor,
              COUNT(*) AS total_runs,
              SUM(d.kills) AS total_kills,
              MIN(CASE WHEN d.outcome = 'cleared' THEN d.duration_ms END) AS fastest_clear_ms
       FROM dungeon_runs d
       JOIN users u ON u.grudge_id = d.grudge_id
       GROUP BY d.grudge_id, u.username, u.faction
       ORDER BY best_floor DESC, fastest_clear_ms ASC
       LIMIT ?`,
      [safeLimit]
    );
    res.json({ type: 'dungeon', leaderboard: rows });
  } catch (err) { next(err); }
});

module.exports = router;
