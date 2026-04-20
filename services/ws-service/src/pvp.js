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

// ── Mode config (loaded from game-api on startup, cached) ────
// Fallback list; authoritative config lives in game-api/src/mode-configs.js
let MODE_CONFIGS = null;
const VALID_MODES_FALLBACK = ['duel', 'crew_battle', 'arena_ffa', 'nemesis', 'rpg_fighter', 'thc_battle'];

async function loadModeConfigs() {
  try {
    const http = require('http');
    const [host, portStr] = (GAME_API_URL.replace('http://', '')).split(':');
    const port = Number(portStr) || 3003;
    const data = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: host, port, path: '/pvp/mode-configs', headers: { 'x-internal-key': INTERNAL_KEY } }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('parse error')); } });
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    if (data?.modes) {
      MODE_CONFIGS = data.modes;
      console.log(`[ws/pvp] Loaded ${Object.keys(MODE_CONFIGS).length} mode configs from game-api`);
    }
  } catch (e) {
    console.warn('[ws/pvp] Could not load mode configs from game-api:', e.message, '— using fallback');
  }
}

function getValidModes() {
  return MODE_CONFIGS ? Object.keys(MODE_CONFIGS) : VALID_MODES_FALLBACK;
}

function isValidAction(mode, actionType) {
  if (!MODE_CONFIGS || !MODE_CONFIGS[mode]) return true; // permissive fallback
  return MODE_CONFIGS[mode].allowedActions.includes(actionType);
}

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

  // Load mode configs from game-api (retry every 10s until successful)
  loadModeConfigs();
  const cfgRetry = setInterval(async () => {
    if (MODE_CONFIGS) { clearInterval(cfgRetry); return; }
    await loadModeConfigs();
  }, 10000);

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

    // ── In-match action relay ─────────────────────────────
    // Action types validated against mode's allowedActions from mode-configs.
    // Clients should pass { lobby_code, type, mode, data }.
    socket.on('pvp:action', ({ lobby_code, type, mode, data } = {}) => {
      if (!lobby_code || !type) return;
      if (!socket.rooms.has(`pvp:lobby:${lobby_code}`)) return;
      if (mode && !isValidAction(mode, type)) return;

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

    // ── Game state push from headless server (internal only) ────
    // The headless server pushes authoritative game state updates
    socket.on('pvp:game_state', ({ lobby_code, state } = {}) => {
      if (!socket.isInternal) return; // only headless server can push state
      if (!lobby_code || !state) return;
      pvpNS.to(`pvp:lobby:${lobby_code}`).emit('pvp:game_state', {
        lobby_code,
        state,
        ts: Date.now(),
      });
    });

    // ── Match result from headless server (internal only) ──────
    // Headless server submits final match result directly via WebSocket
    socket.on('pvp:server_match_end', async ({ lobby_code, winner_grudge_id, winner_team, duration_ms, match_data, server_id } = {}) => {
      if (!socket.isInternal) return;
      if (!lobby_code) return;
      // Forward to game-api via internal HTTP to record result + update ELO
      try {
        const http = require('http');
        const [apiHost, apiPortStr] = (GAME_API_URL.replace('http://', '')).split(':');
        const apiPort = Number(apiPortStr) || 3003;
        const payload = JSON.stringify({ lobby_code, winner_grudge_id, winner_team, duration_ms, match_data });
        const req = http.request({
          hostname: apiHost, port: apiPort, path: '/pvp/match/result', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-internal-key': INTERNAL_KEY,
          },
        }, () => {});
        req.on('error', (e) => console.warn('[ws/pvp] server_match_end relay error:', e.message));
        req.write(payload);
        req.end();

        // Release the server back to idle
        if (server_id) {
          const releasePayload = JSON.stringify({ server_id });
          const relReq = http.request({
            hostname: apiHost, port: apiPort, path: '/pvp/server/release', method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(releasePayload),
              'x-internal-key': INTERNAL_KEY,
            },
          }, () => {});
          relReq.on('error', () => {});
          relReq.write(releasePayload);
          relReq.end();
        }
      } catch (e) {
        console.error('[ws/pvp] server_match_end error:', e.message);
      }
    });

    // ── Queue notifications (client just joined/left queue via REST) ─
    socket.on('pvp:queue_join', ({ mode } = {}) => {
      if (!getValidModes().includes(mode)) return;
      socket.join(`pvp:queue_watch:${mode}`);
    });
    socket.on('pvp:queue_leave', ({ mode } = {}) => {
      if (!getValidModes().includes(mode)) return;
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
    for (const mode of getValidModes()) {
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

  /**
   * Creates a real lobby in game-api via internal HTTP call,
   * then auto-joins the second player.
   * Returns the lobby_code or null on failure.
   */
  async function createMatchmakingLobby(mode, pA, pB) {
    const http = require('http');
    const [host, portStr] = (GAME_API_URL.replace('http://', '')).split(':');
    const port = Number(portStr) || 3003;

    // Helper: make an internal POST to game-api
    function internalPost(path, body) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
          hostname: host, port, path, method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-internal-key': INTERNAL_KEY,
          },
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, body: data }); }
          });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(payload);
        req.end();
      });
    }

    try {
      // 1. Create lobby as player A (host)
      const createRes = await internalPost('/pvp/lobby', {
        mode,
        island: 'spawn',
        char_id: pA.char_id,
        grudge_id: pA.grudge_id,
        settings: { wager_gold: 0, time_limit_s: 300, source: 'matchmaking' },
      });
      if (createRes.status !== 201 || !createRes.body?.lobby_code) {
        console.warn('[ws/pvp] matchmaking lobby create failed:', createRes.body);
        return null;
      }

      const lobby_code = createRes.body.lobby_code;

      // 2. Join player B into the lobby
      const joinRes = await internalPost(`/pvp/lobby/${lobby_code}/join`, {
        char_id: pB.char_id,
        grudge_id: pB.grudge_id,
      });
      if (joinRes.status !== 200) {
        console.warn('[ws/pvp] matchmaking join failed for pB:', joinRes.body);
        // Lobby exists but only host is in — still return code so host isn't stuck
      }

      return lobby_code;
    } catch (err) {
      console.error('[ws/pvp] createMatchmakingLobby error:', err.message);
      return null;
    }
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
              server:     data.server || null,  // { host, port } if dedicated server allocated
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
