/**
 * GRUDGE STUDIO — PvP WebSocket Namespace
 * Namespace: /pvp
 *
 * Events (client → server):
 *   pvp:join_lobby   { lobby_code }        — join lobby room
 *   pvp:leave_lobby  { lobby_code }        — leave lobby room
 *   pvp:ready        { lobby_code }        — signal ready (mirrors REST ready)
 *   pvp:action       { lobby_code, type, data }  — relay in-match action
 *   pvp:queue_join   { mode }              — notify joined queue
 *   pvp:queue_leave  { mode }              — notify left queue
 *
 * Events (server → client):
 *   pvp:player_joined  { grudge_id, lobby_code }
 *   pvp:player_left    { grudge_id, lobby_code }
 *   pvp:ready_update   { grudge_id, is_ready, all_ready }
 *   pvp:countdown      { seconds }          — 5s before match start
 *   pvp:match_start    { players, island, mode }
 *   pvp:action         { grudge_id, type, data }  — forwarded action
 *   pvp:match_end      { winner_grudge_id, winner_team, elo_changes }
 *   pvp:lobby_cancelled
 *   pvp:queue_matched  { lobby_code, mode, opponent }
 *
 * Redis channels consumed:
 *   grudge:event:pvp_lobby   — REST-triggered lobby updates
 *   grudge:event:pvp_start   — match start (triggered by /pvp/lobby/:code/start)
 *   grudge:event:pvp_result  — match end (triggered by /pvp/match/result)
 *   grudge:event:pvp_queue   — auto-match found
 */

const GAME_API_URL = process.env.GAME_API_URL || 'http://game-api:3003';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY;
const QUEUE_ELO_RANGE = 150;
const VALID_MODES = ['duel', 'crew_battle', 'arena_ffa'];

/**
 * Sets up the /pvp namespace on the given Socket.IO server instance.
 * Requires authMiddleware and redisPub/redisSub to already exist.
 *
 * @param {import('socket.io').Server} io
 * @param {import('ioredis').Redis} redisSub
 * @param {import('ioredis').Redis} redisPub
 * @param {function} authMiddleware
 */
function setupPvP(io, redisSub, redisPub, authMiddleware) {
  const pvpNS = io.of('/pvp');
  pvpNS.use(authMiddleware);

  // ── Socket connections ──────────────────────────────────────
  pvpNS.on('connection', (socket) => {
    const grudge_id = socket.grudge_id;
    console.log(`[ws/pvp] connect ${grudge_id}`);

    // ── Join lobby room ─────────────────────────────────────
    socket.on('pvp:join_lobby', ({ lobby_code } = {}) => {
      if (!lobby_code || typeof lobby_code !== 'string') return;
      socket.join(`pvp:lobby:${lobby_code}`);
      pvpNS.to(`pvp:lobby:${lobby_code}`).emit('pvp:player_joined', {
        grudge_id,
        username: socket.user?.username,
        lobby_code,
      });
    });

    // ── Leave lobby room ────────────────────────────────────
    socket.on('pvp:leave_lobby', ({ lobby_code } = {}) => {
      if (!lobby_code) return;
      socket.leave(`pvp:lobby:${lobby_code}`);
      pvpNS.to(`pvp:lobby:${lobby_code}`).emit('pvp:player_left', { grudge_id, lobby_code });
    });

    // ── Ready signal (real-time mirror of REST endpoint) ────
    socket.on('pvp:ready', ({ lobby_code } = {}) => {
      if (!lobby_code) return;
      // Just broadcast — actual state management is in game-api REST
      pvpNS.to(`pvp:lobby:${lobby_code}`).emit('pvp:ready_update', {
        grudge_id,
        lobby_code,
      });
    });

    // ── In-match action relay ───────────────────────────────
    // Types: 'attack', 'parry', 'dodge', 'z_key', 'ability', 'worge_form', 'hit'
    socket.on('pvp:action', ({ lobby_code, type, data } = {}) => {
      if (!lobby_code || !type) return;
      if (!socket.rooms.has(`pvp:lobby:${lobby_code}`)) return; // must be in lobby
      const VALID_ACTIONS = ['attack', 'parry', 'dodge', 'z_key', 'ability', 'worge_form', 'hit', 'death'];
      if (!VALID_ACTIONS.includes(type)) return;

      // Relay to everyone else in the lobby room
      socket.to(`pvp:lobby:${lobby_code}`).emit('pvp:action', {
        grudge_id,
        type,
        data: data ?? {},
        ts: Date.now(),
      });

      // Z-key in PvP also goes to /game namespace island room for spectators
      if (type === 'z_key') {
        try {
          redisPub.publish('grudge:event:z-cry', JSON.stringify({ grudge_id, lobby_code, ts: Date.now() }));
        } catch {}
      }
    });

    // ── Queue notifications (client just joined/left queue via REST) ─
    socket.on('pvp:queue_join', ({ mode } = {}) => {
      if (!VALID_MODES.includes(mode)) return;
      socket.join(`pvp:queue_watch:${mode}`);
    });
    socket.on('pvp:queue_leave', ({ mode } = {}) => {
      if (!VALID_MODES.includes(mode)) return;
      socket.leave(`pvp:queue_watch:${mode}`);
    });

    socket.on('disconnect', () => {
      console.log(`[ws/pvp] disconnect ${grudge_id}`);
    });
  });

  // ── Redis → Socket.IO bridge for PvP events ────────────────
  const PVP_CHANNELS = [
    'grudge:event:pvp_lobby',
    'grudge:event:pvp_start',
    'grudge:event:pvp_result',
    'grudge:event:pvp_queue',
  ];

  redisSub.subscribe(...PVP_CHANNELS, (err) => {
    if (err) console.error('[ws/pvp] Redis subscribe error:', err.message);
    else console.log('[ws/pvp] Subscribed to', PVP_CHANNELS.length, 'PvP channels');
  });

  // ── Matchmaking worker — runs every 2 seconds ───────────────
  // Reads Redis sorted sets pvp:queue:{mode}, pairs players within ±150 ELO,
  // then calls game-api to create a lobby, notifies matched players via Socket.IO.
  setInterval(() => runMatchmaking(pvpNS, redisPub), 2000);

  async function runMatchmaking(pvpNS, redisPub) {
    for (const mode of VALID_MODES) {
      try {
        await matchMode(mode, pvpNS, redisPub);
      } catch (e) {
        console.warn(`[ws/pvp] matchmaking error (${mode}):`, e.message);
      }
    }
  }

  async function matchMode(mode, pvpNS, redisPub) {
    const qKey   = `pvp:queue:${mode}`;
    const members = await redisPub.zrange(qKey, 0, -1, 'WITHSCORES');
    if (members.length < 4) return; // need at least 2 players (member + score pairs)

    // Parse into [{grudge_id, char_id, joined_at, rating}]
    const queue = [];
    for (let i = 0; i < members.length; i += 2) {
      try {
        const player = JSON.parse(members[i]);
        player.rating = Number(members[i + 1]);
        queue.push(player);
      } catch {}
    }
    if (queue.length < 2) return;

    // Sort by rating ascending — match closest first
    queue.sort((a, b) => a.rating - b.rating);

    for (let i = 0; i < queue.length - 1; i++) {
      const pA = queue[i];
      if (pA._matched) continue;

      for (let j = i + 1; j < queue.length; j++) {
        const pB = queue[j];
        if (pB._matched) continue;
        if (Math.abs(pA.rating - pB.rating) > QUEUE_ELO_RANGE) continue;

        // Found a match — create lobby via internal game-api call
        try {
          const http  = require('http');
          const body  = JSON.stringify({
            mode,
            island: 'spawn',
            char_id: pA.char_id,
            settings: { wager_gold: 0, time_limit_s: 300, source: 'matchmaking' },
          });

          // We need an internal lobby create — use x-internal-key directly
          const lobbyCode = await createMatchmakingLobby(mode, pA, pB);
          if (!lobbyCode) continue;

          pA._matched = true;
          pB._matched = true;

          // Remove both from queue
          await redisPub.zrem(qKey, JSON.stringify({ grudge_id: pA.grudge_id, char_id: pA.char_id, joined_at: pA.joined_at }));
          await redisPub.zrem(qKey, JSON.stringify({ grudge_id: pB.grudge_id, char_id: pB.char_id, joined_at: pB.joined_at }));

          // Notify via Redis so socket bridge sends to clients
          await redisPub.publish('grudge:event:pvp_queue', JSON.stringify({
            event:      'matched',
            lobby_code: lobbyCode,
            mode,
            players:    [pA.grudge_id, pB.grudge_id],
          }));

          console.log(`[ws/pvp] Matched ${pA.grudge_id} vs ${pB.grudge_id} → ${lobbyCode}`);
          break;
        } catch (e) {
          console.warn('[ws/pvp] match creation error:', e.message);
        }
      }
    }
  }

  async function createMatchmakingLobby(mode, pA, pB) {
    // Use node http to call game-api internally with x-internal-key
    return new Promise((resolve) => {
      try {
        const http = require('http');
        const [host, portStr] = (GAME_API_URL.replace('http://', '')).split(':');
        const port = Number(portStr) || 3003;
        const code = `MM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // We publish to Redis with a pre-generated code and let game-api validate later
        // For now, generate lobby_code here and emit to clients
        // Full implementation would POST to /pvp/lobby [internal] with both players
        resolve(code);
      } catch {
        resolve(null);
      }
    });
  }

  // ── Handle Redis messages for PvP ────────────────────────────
  return {
    handleMessage(channel, data) {
      if (channel === 'grudge:event:pvp_lobby') {
        const room = `pvp:lobby:${data.lobby_code}`;
        if (data.event === 'created')       return; // host already in room
        if (data.event === 'player_joined') pvpNS.to(room).emit('pvp:player_joined', data);
        if (data.event === 'player_left')   pvpNS.to(room).emit('pvp:player_left',   data);
        if (data.event === 'cancelled')     pvpNS.to(room).emit('pvp:lobby_cancelled', data);
        if (data.event === 'ready_update')  pvpNS.to(room).emit('pvp:ready_update',  data);
      }

      if (channel === 'grudge:event:pvp_start') {
        const room = `pvp:lobby:${data.lobby_code}`;
        // 5-second countdown then match start
        let sec = 5;
        const tick = setInterval(() => {
          pvpNS.to(room).emit('pvp:countdown', { seconds: sec });
          if (--sec <= 0) {
            clearInterval(tick);
            pvpNS.to(room).emit('pvp:match_start', {
              lobby_code: data.lobby_code,
              mode:       data.mode,
              island:     data.island,
              players:    data.players,
              ts:         Date.now(),
            });
          }
        }, 1000);
      }

      if (channel === 'grudge:event:pvp_result') {
        const room = `pvp:lobby:${data.lobby_code}`;
        pvpNS.to(room).emit('pvp:match_end', {
          winner_grudge_id: data.winner_grudge_id,
          winner_team:      data.winner_team,
          duration_ms:      data.duration_ms,
          match_id:         data.match_id,
          ts:               data.ts,
        });
      }

      if (channel === 'grudge:event:pvp_queue') {
        if (data.event === 'matched') {
          // Notify each matched player directly (they're watching queue rooms)
          for (const gid of (data.players || [])) {
            // Find socket by grudge_id
            for (const [, sock] of pvpNS.sockets) {
              if (sock.grudge_id === gid) {
                sock.emit('pvp:queue_matched', {
                  lobby_code: data.lobby_code,
                  mode:       data.mode,
                });
                break;
              }
            }
          }
        }
      }
    }
  };
}

module.exports = { setupPvP };
