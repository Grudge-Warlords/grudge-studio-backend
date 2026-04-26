require('dotenv').config();
require('../../shared/validate-env')(['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 'INTERNAL_API_KEY']);

let Sentry;
if (process.env.SENTRY_DSN) {
  try { Sentry = require('@sentry/node'); Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'production', tracesSampleRate: 0.05 }); console.log('[game-api] Sentry enabled'); } catch (e) { console.warn('[game-api] Sentry init failed:', e.message); }
}

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const { grudgeCors }     = require('../../shared/cors');
const { makeRequireAuth } = require('../../shared/auth');
const discordRoutes  = require('./routes/discord');
const rateLimit  = require('express-rate-limit');
const { initDB, getDB, isHealthy: isDBHealthy, deepCheck: dbDeepCheck } = require('./db');
const { initRedis, isRedisReady } = require('./redis');

const characterRoutes  = require('./routes/characters');
const factionRoutes    = require('./routes/factions');
const missionRoutes    = require('./routes/missions');
const crewRoutes       = require('./routes/crews');
const inventoryRoutes  = require('./routes/inventory');
const professionRoutes = require('./routes/professions');
const gouldstoneRoutes = require('./routes/gouldstones');
const economyRoutes    = require('./routes/economy');
const craftingRoutes   = require('./routes/crafting');
const combatRoutes     = require('./routes/combat');
const islandRoutes     = require('./routes/islands');
const arenaRoutes      = require('./routes/arena');
const playerIslandRoutes = require('./routes/player-islands');
const pvpRoutes        = require('./routes/pvp');
const adminRoutes      = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3003;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7

app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }));
app.use(grudgeCors());

// Discord interactions MUST use raw body for signature verification
// Register BEFORE express.json() so the raw body is accessible
app.use('/api/discord', discordRoutes);

app.use(express.json({ limit: '2mb' }));

// ── Rate limiting ──────────────────────────────────────────────
// Skip for internal service calls (x-internal-key header)
const isInternalReq = (req) => req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY;

// Global limiter — 200 req/min per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 200,
  skip: isInternalReq,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
}));

// Strict limiter for economy write endpoints — 30 req/min
const economyLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  skip: isInternalReq,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Economy rate limit exceeded' },
});

// PvP queue limiter — 20 req/min (prevent queue spam)
const pvpLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  skip: isInternalReq,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'PvP rate limit exceeded' },
});

// ── Auth middleware — shared implementation with live DB ban check ─────────
// Sourced from shared/auth.js. Accepts Grudge JWT or x-internal-key.
// req.user = { grudge_id, username, role, puter_id, is_guest }
const requireAuth = makeRequireAuth(getDB);

// ── Routes ────────────────────────────
app.get('/health', async (req, res) => {
  const dbResult = await dbDeepCheck();
  const redisUp = isRedisReady();

  // Determine overall status
  let status = 'ok';
  if (!dbResult.ok) status = 'down';
  else if (!redisUp) status = 'degraded'; // Redis optional but noted

  const code = status === 'down' ? 503 : 200;
  res.status(code).json({
    status,
    service: 'game-api',
    version: '2.0.0',
    uptime: Math.floor(process.uptime()),
    db:    { ok: dbResult.ok },
    redis: { ok: redisUp },
  });
});
app.use('/characters',  requireAuth, characterRoutes);
app.use('/factions',    requireAuth, factionRoutes);
app.use('/missions',    requireAuth, missionRoutes);
app.use('/crews',       requireAuth, crewRoutes);
app.use('/inventory',   requireAuth, inventoryRoutes);
app.use('/professions', requireAuth, professionRoutes);
app.use('/gouldstones', requireAuth, gouldstoneRoutes);
app.use('/economy',     requireAuth, economyLimiter, economyRoutes);
app.use('/crafting',    requireAuth, craftingRoutes);
app.use('/combat',      requireAuth, combatRoutes);
app.use('/islands',     requireAuth, islandRoutes);
app.use('/arena',       requireAuth, arenaRoutes);
app.use('/player-islands', requireAuth, playerIslandRoutes);
app.use('/pvp',         requireAuth, pvpLimiter, pvpRoutes);
app.use('/admin',       requireAuth, adminRoutes);

app.use((err, req, res, next) => {
  if (Sentry) Sentry.captureException(err);
  console.error('[game-api]', err.message);
  const isClientError = err.status && err.status >= 400 && err.status < 500;
  res.status(err.status || 500).json({ error: isClientError ? err.message : 'Internal error' });
});

(async () => {
  await initDB();
  await initRedis();
  const server = app.listen(PORT, () => console.log(`[game-api] Running on port ${PORT}`));

  function shutdown(signal) {
    console.log(`[game-api] ${signal} — shutting down gracefully`);
    server.close(async () => {
      try { await getDB().pool?.end(); } catch {}
      process.exit(0);
    });
    setTimeout(() => { console.error('[game-api] Forced exit after timeout'); process.exit(1); }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
})();
