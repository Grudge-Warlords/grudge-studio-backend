/**
 * GRUDGE STUDIO — PvP Lobby & Matchmaking Routes
 * Mount: /pvp
 *
 * Public (JWT):
 *   POST   /pvp/lobby                  — Create lobby
 *   POST   /pvp/lobby/:code/join       — Join lobby by code
 *   POST   /pvp/lobby/:code/ready      — Toggle ready
 *   POST   /pvp/lobby/:code/start      — Host starts match
 *   DELETE /pvp/lobby/:code/leave      — Leave lobby
 *   GET    /pvp/lobby/:code            — Lobby state
 *   GET    /pvp/lobbies                — Open lobbies list
 *   GET    /pvp/ratings                — Player ELO ratings
 *   GET    /pvp/leaderboard            — Top players by rating
 *   POST   /pvp/queue                  — Join matchmaking queue
 *   DELETE /pvp/queue                  — Leave matchmaking queue
 *
 * Internal (x-internal-key):
 *   POST   /pvp/match/result           — Record match outcome, update ELO
 */

const express = require('express');
const router  = express.Router();
const { getDB }    = require('../db');
const { getRedis } = require('../redis');

// ── Helpers ──────────────────────────────────────────────────

/** Generate a short lobby code: GRD-XXXX */
function genLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GRD-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const VALID_MODES      = ['duel', 'crew_battle', 'arena_ffa'];
const MODE_MAX_PLAYERS = { duel: 2, crew_battle: 10, arena_ffa: 16 };
const ELO_K           = 32;   // ELO K-factor — higher = faster rating movement
const QUEUE_ELO_RANGE = 150;  // auto-match within ±150 ELO
const QUEUE_TTL_S     = 300;  // remove from queue after 5 minutes

/** ELO expected score formula */
function eloExpected(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Calculate new ELO ratings after a match.
 *  result: 1 = A wins, 0 = B wins, 0.5 = draw */
function calcElo(ratingA, ratingB, result) {
  const expA  = eloExpected(ratingA, ratingB);
  const newA  = Math.round(ratingA + ELO_K * (result - expA));
  const newB  = Math.round(ratingB + ELO_K * ((1 - result) - (1 - expA)));
  return { newA: Math.max(100, newA), newB: Math.max(100, newB) };
}

/** Ensure pvp_ratings row exists for a player/mode. Returns current rating. */
async function ensureRating(db, grudge_id, mode) {
  await db.query(
    `INSERT IGNORE INTO pvp_ratings (grudge_id, mode) VALUES (?, ?)`,
    [grudge_id, mode]
  );
  const [[row]] = await db.query(
    `SELECT rating FROM pvp_ratings WHERE grudge_id = ? AND mode = ?`,
    [grudge_id, mode]
  );
  return row?.rating ?? 1200;
}

/** Resolve grudge_id + validate character ownership */
async function resolveChar(db, char_id, grudge_id) {
  const [[char]] = await db.query(
    `SELECT id, grudge_id, name, class, level FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1`,
    [char_id, grudge_id]
  );
  return char || null;
}

// ── POST /pvp/lobby ──────────────────────────────────────────
// Create a new lobby. Body: { mode, island?, max_players?, settings?, char_id }
router.post('/lobby', async (req, res, next) => {
  try {
    const { mode = 'duel', island = 'spawn', char_id, settings = {} } = req.body;
    const grudge_id = req.user.grudge_id;

    if (!VALID_MODES.includes(mode))
      return res.status(400).json({ error: `mode must be: ${VALID_MODES.join(', ')}` });
    if (!char_id)
      return res.status(400).json({ error: 'char_id required' });

    const db   = getDB();
    const char = await resolveChar(db, char_id, grudge_id);
    if (!char) return res.status(403).json({ error: 'Character not found or not yours' });

    const max_players = Math.min(
      Number(req.body.max_players) || MODE_MAX_PLAYERS[mode],
      MODE_MAX_PLAYERS[mode]
    );

    // Prevent duplicate active lobbies for same host
    const [[existing]] = await db.query(
      `SELECT id FROM pvp_lobbies WHERE host_grudge_id = ? AND status IN ('waiting','ready','in_progress') LIMIT 1`,
      [grudge_id]
    );
    if (existing) return res.status(409).json({ error: 'You already have an active lobby' });

    // Generate unique lobby code (retry on collision)
    let lobby_code, attempts = 0;
    do {
      lobby_code = genLobbyCode();
      const [[clash]] = await db.query(`SELECT id FROM pvp_lobbies WHERE lobby_code = ?`, [lobby_code]);
      if (!clash) break;
    } while (++attempts < 10);

    const [result] = await db.query(
      `INSERT INTO pvp_lobbies (lobby_code, mode, island, host_grudge_id, max_players, settings)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [lobby_code, mode, island, grudge_id, max_players, JSON.stringify(settings)]
    );

    // Auto-join as host with team 1
    await db.query(
      `INSERT INTO pvp_lobby_players (lobby_id, grudge_id, char_id, team)
       VALUES (?, ?, ?, 1)`,
      [result.insertId, grudge_id, char_id]
    );

    // Publish to Redis so ws-service can notify
    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_lobby', JSON.stringify({
        event: 'created', lobby_code, mode, island, host_grudge_id: grudge_id,
      }));
    } catch {}

    res.status(201).json({ lobby_code, lobby_id: result.insertId, mode, island, max_players });
  } catch (err) { next(err); }
});

// ── POST /pvp/lobby/:code/join ───────────────────────────────
// Join an open lobby. Body: { char_id, team? }
router.post('/lobby/:code/join', async (req, res, next) => {
  try {
    const { code }       = req.params;
    const { char_id, team = 0 } = req.body;
    const grudge_id      = req.user.grudge_id;

    if (!char_id) return res.status(400).json({ error: 'char_id required' });

    const db = getDB();
    const char = await resolveChar(db, char_id, grudge_id);
    if (!char) return res.status(403).json({ error: 'Character not found or not yours' });

    const [[lobby]] = await db.query(
      `SELECT id, mode, status, max_players FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`,
      [code]
    );
    if (!lobby)  return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.status !== 'waiting')
      return res.status(409).json({ error: 'Lobby is not open for joining' });

    // Check already joined
    const [[already]] = await db.query(
      `SELECT lobby_id FROM pvp_lobby_players WHERE lobby_id = ? AND grudge_id = ? LIMIT 1`,
      [lobby.id, grudge_id]
    );
    if (already) return res.status(409).json({ error: 'Already in this lobby' });

    // Check capacity
    const [[{ cnt }]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM pvp_lobby_players WHERE lobby_id = ?`,
      [lobby.id]
    );
    if (cnt >= lobby.max_players)
      return res.status(409).json({ error: 'Lobby is full' });

    // Assign team: crew_battle auto-balances, duel gets team 2, FFA gets 0
    let assignedTeam = team;
    if (lobby.mode === 'duel')         assignedTeam = 2;
    else if (lobby.mode === 'arena_ffa') assignedTeam = 0;

    await db.query(
      `INSERT INTO pvp_lobby_players (lobby_id, grudge_id, char_id, team) VALUES (?, ?, ?, ?)`,
      [lobby.id, grudge_id, char_id, assignedTeam]
    );

    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_lobby', JSON.stringify({
        event: 'player_joined', lobby_code: code, grudge_id,
      }));
    } catch {}

    res.json({ ok: true, lobby_code: code });
  } catch (err) { next(err); }
});

// ── POST /pvp/lobby/:code/ready ──────────────────────────────
// Toggle ready status for the calling player.
router.post('/lobby/:code/ready', async (req, res, next) => {
  try {
    const { code }  = req.params;
    const grudge_id = req.user.grudge_id;
    const db        = getDB();

    const [[lobby]] = await db.query(
      `SELECT id, status FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`, [code]
    );
    if (!lobby)  return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.status !== 'waiting' && lobby.status !== 'ready')
      return res.status(409).json({ error: 'Lobby is not in waiting state' });

    const [[player]] = await db.query(
      `SELECT is_ready FROM pvp_lobby_players WHERE lobby_id = ? AND grudge_id = ? LIMIT 1`,
      [lobby.id, grudge_id]
    );
    if (!player) return res.status(403).json({ error: 'Not in this lobby' });

    const newReady = !player.is_ready;
    await db.query(
      `UPDATE pvp_lobby_players SET is_ready = ? WHERE lobby_id = ? AND grudge_id = ?`,
      [newReady, lobby.id, grudge_id]
    );

    // Check if ALL players are ready → set lobby to 'ready'
    const [[{ cnt, ready_cnt }]] = await db.query(
      `SELECT COUNT(*) AS cnt, SUM(is_ready) AS ready_cnt FROM pvp_lobby_players WHERE lobby_id = ?`,
      [lobby.id]
    );
    const allReady = cnt >= 2 && cnt === Number(ready_cnt);
    if (allReady) {
      await db.query(`UPDATE pvp_lobbies SET status = 'ready' WHERE id = ?`, [lobby.id]);
    } else if (lobby.status === 'ready') {
      await db.query(`UPDATE pvp_lobbies SET status = 'waiting' WHERE id = ?`, [lobby.id]);
    }

    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_lobby', JSON.stringify({
        event: 'ready_update', lobby_code: code, grudge_id, is_ready: newReady, all_ready: allReady,
      }));
    } catch {}

    res.json({ is_ready: newReady, all_ready: allReady });
  } catch (err) { next(err); }
});

// ── POST /pvp/lobby/:code/start ──────────────────────────────
// Host starts the match. All players must be ready.
router.post('/lobby/:code/start', async (req, res, next) => {
  try {
    const { code }  = req.params;
    const grudge_id = req.user.grudge_id;
    const db        = getDB();

    const [[lobby]] = await db.query(
      `SELECT id, mode, island, host_grudge_id, status, max_players FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`,
      [code]
    );
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.host_grudge_id !== grudge_id)
      return res.status(403).json({ error: 'Only the host can start the match' });
    if (lobby.status !== 'ready' && lobby.status !== 'waiting')
      return res.status(409).json({ error: 'Lobby is not ready to start' });

    const [players] = await db.query(
      `SELECT lp.grudge_id, lp.char_id, lp.team, lp.is_ready,
              c.name, c.class, c.level, c.hp, c.max_hp, c.strength, c.dexterity, c.intelligence
       FROM pvp_lobby_players lp
       JOIN characters c ON c.id = lp.char_id
       WHERE lp.lobby_id = ?`,
      [lobby.id]
    );

    if (players.length < 2)
      return res.status(409).json({ error: 'Need at least 2 players to start' });

    const unready = players.filter(p => !p.is_ready);
    if (unready.length > 0)
      return res.status(409).json({ error: `${unready.length} player(s) not ready` });

    await db.query(
      `UPDATE pvp_lobbies SET status = 'in_progress', started_at = NOW() WHERE id = ?`,
      [lobby.id]
    );

    // Publish start event — ws-service will handle countdown + match_start broadcast
    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_start', JSON.stringify({
        lobby_code: code,
        lobby_id:   lobby.id,
        mode:       lobby.mode,
        island:     lobby.island,
        players:    players.map(p => ({
          grudge_id: p.grudge_id,
          char_id:   p.char_id,
          team:      p.team,
          name:      p.name,
          class:     p.class,
          level:     p.level,
          hp:        p.max_hp,
        })),
        ts: Date.now(),
      }));
    } catch {}

    res.json({ ok: true, lobby_code: code, mode: lobby.mode, island: lobby.island, player_count: players.length });
  } catch (err) { next(err); }
});

// ── DELETE /pvp/lobby/:code/leave ────────────────────────────
// Leave a lobby. If host leaves, lobby is cancelled.
router.delete('/lobby/:code/leave', async (req, res, next) => {
  try {
    const { code }  = req.params;
    const grudge_id = req.user.grudge_id;
    const db        = getDB();

    const [[lobby]] = await db.query(
      `SELECT id, host_grudge_id, status FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`, [code]
    );
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.status === 'in_progress')
      return res.status(409).json({ error: 'Cannot leave a match in progress' });

    await db.query(
      `DELETE FROM pvp_lobby_players WHERE lobby_id = ? AND grudge_id = ?`,
      [lobby.id, grudge_id]
    );

    // If host left, cancel the lobby
    if (lobby.host_grudge_id === grudge_id) {
      await db.query(
        `UPDATE pvp_lobbies SET status = 'cancelled' WHERE id = ?`, [lobby.id]
      );
    }

    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_lobby', JSON.stringify({
        event: lobby.host_grudge_id === grudge_id ? 'cancelled' : 'player_left',
        lobby_code: code, grudge_id,
      }));
    } catch {}

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /pvp/lobby/:code ─────────────────────────────────────
// Full lobby state with players.
router.get('/lobby/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDB();

    const [[lobby]] = await db.query(
      `SELECT id, lobby_code, mode, island, host_grudge_id, status, max_players, settings, created_at, started_at
       FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`,
      [code]
    );
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    const [players] = await db.query(
      `SELECT lp.grudge_id, lp.char_id, lp.team, lp.is_ready,
              c.name AS char_name, c.class, c.level,
              u.username
       FROM pvp_lobby_players lp
       JOIN characters c ON c.id = lp.char_id
       JOIN users u ON u.grudge_id = lp.grudge_id
       WHERE lp.lobby_id = ?
       ORDER BY lp.joined_at ASC`,
      [lobby.id]
    );

    res.json({ ...lobby, players });
  } catch (err) { next(err); }
});

// ── GET /pvp/lobbies ─────────────────────────────────────────
// List open lobbies. Query: ?mode=duel&island=spawn&limit=20
router.get('/lobbies', async (req, res, next) => {
  try {
    const { mode, island, limit = 20 } = req.query;
    const db = getDB();

    let sql = `
      SELECT pl.lobby_code, pl.mode, pl.island, pl.host_grudge_id,
             pl.max_players, pl.settings, pl.created_at,
             u.username AS host_username,
             COUNT(plp.grudge_id) AS player_count
      FROM pvp_lobbies pl
      JOIN users u ON u.grudge_id = pl.host_grudge_id
      LEFT JOIN pvp_lobby_players plp ON plp.lobby_id = pl.id
      WHERE pl.status = 'waiting'
    `;
    const params = [];
    if (mode)   { sql += ' AND pl.mode = ?';   params.push(mode); }
    if (island) { sql += ' AND pl.island = ?'; params.push(island); }
    sql += ` GROUP BY pl.id ORDER BY pl.created_at DESC LIMIT ?`;
    params.push(Math.min(Number(limit) || 20, 100));

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /pvp/queue ──────────────────────────────────────────
// Join matchmaking queue. Body: { mode, char_id }
// Uses Redis sorted set pvp:queue:{mode} scored by ELO rating.
router.post('/queue', async (req, res, next) => {
  try {
    const { mode = 'duel', char_id } = req.body;
    const grudge_id = req.user.grudge_id;

    if (!VALID_MODES.includes(mode))
      return res.status(400).json({ error: `mode must be: ${VALID_MODES.join(', ')}` });
    if (!char_id)
      return res.status(400).json({ error: 'char_id required' });

    const db   = getDB();
    const char = await resolveChar(db, char_id, grudge_id);
    if (!char) return res.status(403).json({ error: 'Character not found or not yours' });

    const rating = await ensureRating(db, grudge_id, mode);
    const redis  = getRedis();
    const qKey   = `pvp:queue:${mode}`;
    const pData  = JSON.stringify({ grudge_id, char_id: Number(char_id), joined_at: Date.now() });

    // Add to sorted set with ELO as score. Expire the whole key if nobody queues.
    await redis.zadd(qKey, rating, pData);
    await redis.expire(qKey, QUEUE_TTL_S);

    res.json({ ok: true, mode, rating, position: await redis.zcard(qKey) });
  } catch (err) { next(err); }
});

// ── DELETE /pvp/queue ────────────────────────────────────────
// Leave matchmaking queue. Body: { mode }
router.delete('/queue', async (req, res, next) => {
  try {
    const { mode = 'duel' } = req.body;
    const grudge_id         = req.user.grudge_id;

    if (!VALID_MODES.includes(mode))
      return res.status(400).json({ error: `mode must be: ${VALID_MODES.join(', ')}` });

    const redis = getRedis();
    const qKey  = `pvp:queue:${mode}`;

    // Remove all entries matching this grudge_id (scan since value is JSON)
    const members = await redis.zrange(qKey, 0, -1);
    for (const m of members) {
      try {
        if (JSON.parse(m).grudge_id === grudge_id) {
          await redis.zrem(qKey, m);
          break;
        }
      } catch {}
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /pvp/ratings ─────────────────────────────────────────
// Get ELO ratings for a player. Query: ?grudge_id=X (or own if omitted)
router.get('/ratings', async (req, res, next) => {
  try {
    const target = req.query.grudge_id || req.user.grudge_id;
    const db     = getDB();

    const [rows] = await db.query(
      `SELECT mode, rating, wins, losses, draws, streak, peak_rating, updated_at
       FROM pvp_ratings WHERE grudge_id = ? ORDER BY rating DESC`,
      [target]
    );
    res.json({ grudge_id: target, ratings: rows });
  } catch (err) { next(err); }
});

// ── GET /pvp/leaderboard ─────────────────────────────────────
// Top players by ELO for a mode. Query: ?mode=duel&limit=50
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { mode = 'duel', limit = 50 } = req.query;

    if (!VALID_MODES.includes(mode))
      return res.status(400).json({ error: `mode must be: ${VALID_MODES.join(', ')}` });

    const db = getDB();
    const [rows] = await db.query(
      `SELECT pr.grudge_id, u.username, u.faction,
              pr.rating, pr.wins, pr.losses, pr.streak, pr.peak_rating,
              ROUND(pr.wins / GREATEST(pr.wins + pr.losses, 1) * 100, 1) AS win_rate
       FROM pvp_ratings pr
       JOIN users u ON u.grudge_id = pr.grudge_id
       WHERE pr.mode = ? AND (pr.wins + pr.losses) > 0
       ORDER BY pr.rating DESC, pr.wins DESC
       LIMIT ?`,
      [mode, Math.min(Number(limit) || 50, 200)]
    );

    res.json({ mode, leaderboard: rows });
  } catch (err) { next(err); }
});

// ── POST /pvp/match/result [INTERNAL] ────────────────────────
// Record final match result and update ELO ratings.
// Body: { lobby_code, winner_grudge_id?, winner_team?, duration_ms, match_data? }
router.post('/match/result', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });

    const {
      lobby_code,
      winner_grudge_id = null,
      winner_team      = null,
      duration_ms      = 0,
      match_data       = {},
    } = req.body;

    if (!lobby_code) return res.status(400).json({ error: 'lobby_code required' });

    const db = getDB();
    const [[lobby]] = await db.query(
      `SELECT id, mode, island, status FROM pvp_lobbies WHERE lobby_code = ? LIMIT 1`,
      [lobby_code]
    );
    if (!lobby)               return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.status !== 'in_progress')
      return res.status(409).json({ error: 'Lobby is not in progress' });

    // Record match
    const [matchResult] = await db.query(
      `INSERT INTO pvp_matches (lobby_id, mode, island, winner_grudge_id, winner_team, duration_ms, match_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lobby.id, lobby.mode, lobby.island, winner_grudge_id, winner_team,
       duration_ms, JSON.stringify(match_data)]
    );

    // Mark lobby finished
    await db.query(
      `UPDATE pvp_lobbies SET status = 'finished', finished_at = NOW() WHERE id = ?`,
      [lobby.id]
    );

    // ── Update ELO ratings for duel mode (1v1) ───────────────
    if (lobby.mode === 'duel' && winner_grudge_id) {
      const [players] = await db.query(
        `SELECT grudge_id FROM pvp_lobby_players WHERE lobby_id = ?`, [lobby.id]
      );
      if (players.length === 2) {
        const [pA, pB] = players;
        const ratingA = await ensureRating(db, pA.grudge_id, lobby.mode);
        const ratingB = await ensureRating(db, pB.grudge_id, lobby.mode);

        const resultA = pA.grudge_id === winner_grudge_id ? 1 :
                        pB.grudge_id === winner_grudge_id ? 0 : 0.5;
        const { newA, newB } = calcElo(ratingA, ratingB, resultA);

        for (const [gid, newRating, result] of [
          [pA.grudge_id, newA, resultA],
          [pB.grudge_id, newB, 1 - resultA],
        ]) {
          const win    = result === 1;
          const loss   = result === 0;
          const draw   = result === 0.5;
          await db.query(
            `UPDATE pvp_ratings SET
               rating      = ?,
               peak_rating = GREATEST(peak_rating, ?),
               wins        = wins   + ?,
               losses      = losses + ?,
               draws       = draws  + ?,
               streak      = IF(? = 1, GREATEST(streak + 1, 1),
                              IF(? = 0, LEAST(streak - 1, -1), 0))
             WHERE grudge_id = ? AND mode = ?`,
            [newRating, newRating,
             win ? 1 : 0, loss ? 1 : 0, draw ? 1 : 0,
             result, result,
             gid, lobby.mode]
          );
        }
      }
    }

    // Publish result for ws-service to broadcast
    try {
      const redis = getRedis();
      await redis.publish('grudge:event:pvp_result', JSON.stringify({
        lobby_code,
        match_id:        matchResult.insertId,
        mode:            lobby.mode,
        winner_grudge_id,
        winner_team,
        duration_ms,
        ts:              Date.now(),
      }));
    } catch {}

    res.status(201).json({ match_id: matchResult.insertId, ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
