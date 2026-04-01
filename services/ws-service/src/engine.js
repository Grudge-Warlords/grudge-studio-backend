/**
 * GRUDGE STUDIO — Engine WebSocket Namespace
 * Namespace: /engine
 *
 * Provides real-time features for The Engine (retro game portal):
 *   - Presence: who's playing what game
 *   - Live score events: personal bests, global records
 *   - Challenge notifications: created, accepted, completed
 *   - Activity feed: recent scores across all games
 *
 * Events (client → server):
 *   engine:join_game   { game_id, game_title }  — player starts a game
 *   engine:leave_game  { game_id }              — player stops a game
 *   engine:submit_score { game_id, score, score_type, metadata }
 *
 * Events (server → client):
 *   engine:presence     { game_id, game_title, player_count }
 *   engine:player_joined { game_id, grudge_id, username }
 *   engine:player_left   { game_id, grudge_id }
 *   engine:score_event   { grudge_id, username, game_id, game_title, score, isPersonalBest, isGlobalRecord }
 *   engine:challenge     { event, ... }   — challenge lifecycle events
 *   engine:activity      { type, ... }    — general activity feed item
 *
 * Redis channels consumed:
 *   grudge:event:engine_score     — score submitted via REST
 *   grudge:event:engine_challenge — challenge state change
 */

// Track active players per game: game_id → Set<grudge_id>
const gamePresence = new Map();
// Track which game each socket is in: socket.id → { game_id, game_title }
const socketGames = new Map();

/**
 * Sets up the /engine namespace.
 * @param {import('socket.io').Server} io
 * @param {import('ioredis').Redis} redisSub
 * @param {import('ioredis').Redis} redisPub
 * @param {function} authMiddleware
 */
function setupEngine(io, redisSub, redisPub, authMiddleware) {
  const engineNS = io.of('/engine');

  // Auth is optional for engine — allow guests to see presence
  engineNS.use((socket, next) => {
    try {
      authMiddleware(socket, next);
    } catch {
      // Allow unauthenticated connections with limited capabilities
      socket.grudge_id = `guest_${socket.id.slice(0, 8)}`;
      socket.user = { username: 'Guest' };
      next();
    }
  });

  engineNS.on('connection', (socket) => {
    const grudge_id = socket.grudge_id;
    console.log(`[ws/engine] connect ${grudge_id}`);

    // ── Join a game room (presence tracking) ────────────────
    socket.on('engine:join_game', ({ game_id, game_title } = {}) => {
      if (!game_id) return;
      const gameKey = String(game_id);

      // Leave any previous game room
      const prev = socketGames.get(socket.id);
      if (prev) leaveGame(socket, prev.game_id);

      // Join new game room
      socket.join(`engine:game:${gameKey}`);
      socketGames.set(socket.id, { game_id: gameKey, game_title: game_title || `Game #${game_id}` });

      if (!gamePresence.has(gameKey)) gamePresence.set(gameKey, new Set());
      gamePresence.get(gameKey).add(grudge_id);

      // Broadcast join to game room
      engineNS.to(`engine:game:${gameKey}`).emit('engine:player_joined', {
        game_id: gameKey,
        grudge_id,
        username: socket.user?.username || 'Guest',
      });

      // Broadcast updated presence to all
      broadcastPresence(engineNS, gameKey, game_title || `Game #${game_id}`);

      // Publish to Redis for cross-service awareness
      try {
        redisPub.publish('grudge:event:engine_presence', JSON.stringify({
          event: 'join', game_id: gameKey, grudge_id, ts: Date.now(),
        }));
      } catch {}
    });

    // ── Leave game room ─────────────────────────────────────
    socket.on('engine:leave_game', ({ game_id } = {}) => {
      if (!game_id) return;
      leaveGame(socket, String(game_id));
    });

    // ── Disconnect cleanup ──────────────────────────────────
    socket.on('disconnect', () => {
      const prev = socketGames.get(socket.id);
      if (prev) leaveGame(socket, prev.game_id);
      socketGames.delete(socket.id);
      console.log(`[ws/engine] disconnect ${grudge_id}`);
    });

    function leaveGame(sock, gameKey) {
      sock.leave(`engine:game:${gameKey}`);
      const players = gamePresence.get(gameKey);
      if (players) {
        players.delete(grudge_id);
        if (players.size === 0) gamePresence.delete(gameKey);
      }

      engineNS.to(`engine:game:${gameKey}`).emit('engine:player_left', {
        game_id: gameKey,
        grudge_id,
      });

      const info = socketGames.get(sock.id);
      broadcastPresence(engineNS, gameKey, info?.game_title || `Game #${gameKey}`);
      if (socketGames.get(sock.id)?.game_id === gameKey) {
        socketGames.delete(sock.id);
      }
    }
  });

  // ── Redis → Socket.IO bridge for engine events ────────────
  const ENGINE_CHANNELS = [
    'grudge:event:engine_score',
    'grudge:event:engine_challenge',
  ];

  redisSub.subscribe(...ENGINE_CHANNELS, (err) => {
    if (err) console.error('[ws/engine] Redis subscribe error:', err.message);
    else console.log('[ws/engine] Subscribed to', ENGINE_CHANNELS.length, 'channels');
  });

  redisSub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      if (channel === 'grudge:event:engine_score') {
        // Broadcast score event to the game room + global
        const gameKey = String(data.game_id);
        engineNS.to(`engine:game:${gameKey}`).emit('engine:score_event', data);
        engineNS.emit('engine:activity', { type: 'score', ...data });
      }

      if (channel === 'grudge:event:engine_challenge') {
        // Broadcast challenge events globally
        engineNS.emit('engine:challenge', data);
        engineNS.emit('engine:activity', { type: 'challenge', ...data });
      }
    } catch (e) {
      console.warn('[ws/engine] bad message on', channel, e.message);
    }
  });

  return {
    getPresence() {
      const result = {};
      for (const [gameId, players] of gamePresence) {
        result[gameId] = players.size;
      }
      return result;
    },
  };
}

function broadcastPresence(ns, gameKey, gameTitle) {
  const players = gamePresence.get(gameKey);
  ns.emit('engine:presence', {
    game_id: gameKey,
    game_title: gameTitle,
    player_count: players ? players.size : 0,
  });
}

module.exports = { setupEngine };
