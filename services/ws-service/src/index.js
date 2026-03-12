require('dotenv').config();
const http    = require('http');
const express = require('express');
const { Server } = require('socket.io');
const jwt     = require('jsonwebtoken');
const Redis   = require('ioredis');
const { setupPvP } = require('./pvp');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3007;

const JWT_SECRET      = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const REDIS_URL       = process.env.REDIS_URL || 'redis://:@grudge-redis:6379';

// ── CORS origins ──────────────────────────────
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  'https://grudgewarlords.com,https://grudge-studio.com'
).split(',').map(o => o.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  CORS_ORIGINS.push('http://localhost:3000', 'http://localhost:5173');
}

// ── Socket.IO ─────────────────────────────────
const io = new Server(server, {
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'], credentials: true },
  // Traefik sticky sessions via client ID header
  allowEIO3: true,
});

// ── Redis pub/sub ─────────────────────────────
// Separate connections: one for pub (game-api publishes), one for sub (we listen)
const redisSub = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);

redisSub.on('error', err => console.error('[ws] Redis sub error:', err.message));
redisPub.on('error', err => console.error('[ws] Redis pub error:', err.message));

// ── JWT auth middleware ───────────────────────
function authMiddleware(socket, next) {
  // Internal game server can connect with x-internal-key header
  const internalKey = socket.handshake.headers['x-internal-key'] ||
                      socket.handshake.auth?.internal_key;
  if (internalKey === INTERNAL_API_KEY) {
    socket.isInternal = true;
    socket.grudge_id  = 'internal';
    return next();
  }

  const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace('Bearer ', '');
  if (!token) return next(new Error('Authentication required'));

  try {
    const payload  = jwt.verify(token, JWT_SECRET);
    socket.user    = payload;
    socket.grudge_id = payload.grudge_id;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

// ── /game namespace — island rooms ───────────
// Clients join by island: socket.emit('join:island', 'crusade_island')
const gameNS = io.of('/game');
gameNS.use(authMiddleware);

gameNS.on('connection', (socket) => {
  console.log(`[ws/game] connect ${socket.grudge_id}`);

  socket.on('join:island', (island) => {
    if (typeof island !== 'string' || island.length > 64) return;
    // Leave previous island rooms
    for (const room of socket.rooms) {
      if (room !== socket.id && room.startsWith('island:')) {
        socket.leave(room);
        gameNS.to(room).emit('player:leave', { grudge_id: socket.grudge_id, island: room.slice(7) });
      }
    }
    socket.join(`island:${island}`);
    gameNS.to(`island:${island}`).emit('player:join', {
      grudge_id: socket.grudge_id,
      username:  socket.user?.username,
      island,
    });
    // Publish to Redis so other services know
    redisPub.publish('grudge:event:player_join', JSON.stringify({
      grudge_id: socket.grudge_id,
      island,
      ts: Date.now(),
    })).catch(() => {});
  });

  // Z-key combat trigger — broadcast to island room
  socket.on('combat:z_key', (data) => {
    const island = [...socket.rooms].find(r => r.startsWith('island:'));
    if (!island) return;
    gameNS.to(island).emit('combat:z_key', {
      grudge_id: socket.grudge_id,
      stacks:    typeof data?.stacks === 'number' ? Math.min(data.stacks, 10) : 1,
      ts:        Date.now(),
    });
  });

  // Faction event broadcast (internal only)
  socket.on('faction:event', (data) => {
    if (!socket.isInternal) return;
    gameNS.emit('faction:event', data);
  });

  socket.on('disconnect', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('island:')) {
        gameNS.to(room).emit('player:leave', {
          grudge_id: socket.grudge_id,
          island: room.slice(7),
        });
      }
    }
    console.log(`[ws/game] disconnect ${socket.grudge_id}`);
  });
});

// ── /crew namespace — crew chat + events ─────
const crewNS = io.of('/crew');
crewNS.use(authMiddleware);

crewNS.on('connection', (socket) => {
  console.log(`[ws/crew] connect ${socket.grudge_id}`);

  socket.on('join:crew', (crew_id) => {
    if (!crew_id) return;
    socket.join(`crew:${crew_id}`);
  });

  socket.on('crew:message', (data) => {
    const { crew_id, text } = data || {};
    if (!crew_id || !text || typeof text !== 'string') return;
    if (text.length > 500) return;
    const room = `crew:${crew_id}`;
    if (!socket.rooms.has(room)) return; // must be joined
    crewNS.to(room).emit('crew:message', {
      grudge_id: socket.grudge_id,
      username:  socket.user?.username,
      text:      text.trim(),
      ts:        Date.now(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`[ws/crew] disconnect ${socket.grudge_id}`);
  });
});

// ── /pvp namespace ────────────────────────────────────────────
const pvpHandler = setupPvP(io, redisSub, redisPub, authMiddleware);

// ── /global namespace — faction standings + announcements ───
const globalNS = io.of('/global');
globalNS.use(authMiddleware);

globalNS.on('connection', (socket) => {
  socket.join('global');
  console.log(`[ws/global] connect ${socket.grudge_id}`);
  socket.on('disconnect', () => {
    console.log(`[ws/global] disconnect ${socket.grudge_id}`);
  });
});

// ── Redis → Socket.IO bridge ──────────────────
// game-api and ai-agent publish events; we forward to connected clients.
// PvP channels are handled by pvp.js (setupPvP subscribes them separately).
const PVP_CHANNELS = new Set([
  'grudge:event:pvp_lobby',
  'grudge:event:pvp_start',
  'grudge:event:pvp_result',
  'grudge:event:pvp_queue',
]);

const CHANNEL_MAP = {
  'grudge:event:mission':     (data) => globalNS.emit('mission:complete', data),
  'grudge:event:faction':     (data) => globalNS.emit('faction:event',    data),
  'grudge:event:combat':      (data) => {
    if (data.island) gameNS.to(`island:${data.island}`).emit('combat:update', data);
  },
  'grudge:event:island':      (data) => {
    if (data.island) gameNS.to(`island:${data.island}`).emit('island:state', data);
  },
  'grudge:event:crew':        (data) => {
    if (data.crew_id) crewNS.to(`crew:${data.crew_id}`).emit('crew:event', data);
  },
  'grudge:event:player_join': (data) => {
    if (data.island) gameNS.to(`island:${data.island}`).emit('island:players', data);
  },
};

redisSub.subscribe(...Object.keys(CHANNEL_MAP), (err) => {
  if (err) console.error('[ws] Redis subscribe error:', err.message);
  else console.log('[ws] Subscribed to', Object.keys(CHANNEL_MAP).length, 'channels');
});

redisSub.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    // Route PvP events to pvp handler
    if (PVP_CHANNELS.has(channel)) {
      pvpHandler.handleMessage(channel, data);
      return;
    }
    const handler = CHANNEL_MAP[channel];
    if (handler) handler(data);
  } catch (e) {
    console.warn('[ws] bad message on', channel, e.message);
  }
});

// ── HTTP health endpoint ──────────────────────
app.get('/health', (req, res) => {
  const pvpNS = io.of('/pvp');
  res.json({
    status:    'ok',
    service:   'ws-service',
    version:   '2.0.0',
    connected: {
      game:   gameNS.sockets.size,
      crew:   crewNS.sockets.size,
      global: globalNS.sockets.size,
      pvp:    pvpNS.sockets.size,
    },
  });
});

server.listen(PORT, () => {
  console.log(`[ws-service] Running on port ${PORT}`);
});
