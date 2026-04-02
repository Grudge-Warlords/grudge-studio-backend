require('dotenv').config();
require('../../shared/validate-env')(['JWT_SECRET', 'INTERNAL_API_KEY']);

let Sentry;
if (process.env.SENTRY_DSN) {
  try { Sentry = require('@sentry/node'); Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'production', tracesSampleRate: 0.05 }); console.log('[ws-service] Sentry enabled'); } catch (e) { console.warn('[ws-service] Sentry init failed:', e.message); }
}

const http    = require('http');
const express = require('express');
const { Server } = require('socket.io');
const jwt     = require('jsonwebtoken');
const Redis   = require('ioredis');
const { setupPvP } = require('./pvp');
const { setupEngine } = require('./engine');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3007;

const JWT_SECRET      = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// ── Redis — use hostname so it never breaks on container IP change ────────
// Priority: REDIS_HOST env var → Docker DNS name 'grudge-redis' → fallback IP
const REDIS_HOST = process.env.REDIS_HOST || 'grudge-redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
// Extract password from REDIS_URL (redis://:password@host:port) or REDIS_PASSWORD env
let REDIS_PASS = process.env.REDIS_PASSWORD || '';
if (!REDIS_PASS && process.env.REDIS_URL) {
  const m = process.env.REDIS_URL.match(/redis:\/\/[^:]*:([^@]+)@/);
  if (m) REDIS_PASS = decodeURIComponent(m[1]);
}
const REDIS_OPTS = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASS || undefined,
  retryStrategy:       (t) => Math.min(t * 500, 10_000),  // max 10s between retries
  maxRetriesPerRequest: 3,    // stop log-flooding after 3 attempts per command
  connectTimeout:       5_000,
  lazyConnect:          false,
};

// ── CORS — shared module ──────────────────────
// Inline CORS config (shared/cors not available in container image)
const CORS_ORIGINS_LIST = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const GRUDGE_PATTERNS = [
  /^https?:\/\/([a-z0-9-]+\.)?grudge-studio\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgestudio\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgewarlords\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgeplatform\.io$/,
];
const GRUDGE_VERCEL_PREFIXES = ['grudge-','warlord-','dungeon-crawler','gdevelop-','grudachain','gruda-'];
function isAllowedOrigin(o) {
  if (!o) return true;
  if (GRUDGE_PATTERNS.some(p => p.test(o))) return true;
  if (/^https:\/\/[a-z0-9-]+\.puter\.site$/.test(o)) return true;
  if (/^https:\/\/[a-z0-9-]+\.grudge\.workers\.dev$/.test(o)) return true;
  const vm = o.match(/^https:\/\/([a-z0-9-]+)\.vercel\.app$/);
  if (vm && GRUDGE_VERCEL_PREFIXES.some(p => vm[1].startsWith(p))) return true;
  if (CORS_ORIGINS_LIST.includes(o)) return true;
  return false;
}
function grudgeCorsConfig() {
  return { origin: (o, cb) => isAllowedOrigin(o) ? cb(null, true) : cb(null, false), methods: ['GET','POST'], credentials: true };
}

// ── Socket.IO ─────────────────────────────────
const io = new Server(server, {
  cors: grudgeCorsConfig(),
  // Traefik sticky sessions via client ID header
  allowEIO3: true,
});

// ── Redis pub/sub ─────────────────────────────
// Separate connections: one for pub (game-api publishes), one for sub (we listen)
const redisSub = new Redis(REDIS_OPTS);
const redisPub = new Redis(REDIS_OPTS);

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

// ── /engine namespace — The Engine presence + scores + challenges ──
const engineHandler = setupEngine(io, redisSub, redisPub, authMiddleware);

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
// CORS enabled so browser clients (dash.grudge-studio.com, engine.grudge-studio.com)
// can fetch this endpoint without being blocked by the browser.
const HEALTH_CORS_ORIGINS = [
  /^https?:\/\/([a-z0-9-]+\.)?grudge-studio\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgewarlords\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgeplatform\.io$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/[a-z0-9-]+\.puter\.site$/,
  /^http:\/\/localhost(:\d+)?$/,
];

app.get('/health', async (req, res) => {
  // Inline CORS — allow all Grudge subdomains, Vercel, Puter, localhost
  const origin = req.headers.origin;
  if (!origin || HEALTH_CORS_ORIGINS.some(p => p.test(origin))) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const pvpNS    = io.of('/pvp');
  const engineNS = io.of('/engine');

  // Live Redis connectivity check
  let redisStatus = 'unknown';
  try {
    await Promise.race([
      redisPub.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
    ]);
    redisStatus = 'ok';
  } catch {
    redisStatus = 'error';
  }

  const healthy = redisStatus === 'ok';
  res.status(healthy ? 200 : 200).json({   // keep 200 for Coolify health check
    status:    healthy ? 'ok' : 'degraded',
    service:   'ws-service',
    version:   '2.1.0',
    redis:     redisStatus,
    connected: {
      game:   gameNS.sockets.size,
      crew:   crewNS.sockets.size,
      global: globalNS.sockets.size,
      pvp:    pvpNS.sockets.size,
      engine: engineNS.sockets.size,
    },
    enginePresence: engineHandler.getPresence(),
  });
});

server.listen(PORT, () => console.log(`[ws-service] Running on port ${PORT}`));

function shutdown(signal) {
  console.log(`[ws-service] ${signal} — shutting down gracefully`);
  io.close(() => {
    server.close(() => {
      try { redisSub.disconnect(); redisPub.disconnect(); } catch {}
      process.exit(0);
    });
  });
  setTimeout(() => { console.error('[ws-service] Forced exit after timeout'); process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
