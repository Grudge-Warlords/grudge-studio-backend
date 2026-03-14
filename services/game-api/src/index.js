require('dotenv').config();
const path       = require('path');
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const { initDB } = require('./db');
const { initRedis } = require('./redis');

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
const pvpRoutes        = require('./routes/pvp');

const app = express();
const PORT = process.env.PORT || 3003;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7

// ── Dynamic CORS — supports GitHub Pages, puter apps, ObjectStore ────
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  'https://grudgewarlords.com,https://grudge-studio.com,https://grudgestudio.com,https://grudachain.grudge-studio.com,https://dash.grudge-studio.com'
).split(',').map(o => o.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  CORS_ORIGINS.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173');
}

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      scriptSrc:  ["'self'"],
      fontSrc:    ["'self'"],
    },
  },
}));
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ── Static assets (favicon, etc.) ──────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));

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

// ── Auth middleware — accepts Grudge JWT or internal API key ───
// Ban check: if JWT payload has is_banned, reject. Full DB check via getDB() is available
// but we rely on token re-issue on login to propagate bans quickly (7d token TTL).
// For instant ban enforcement, internal services should call grudge-id /auth/verify.
async function requireAuth(req, res, next) {
  // Game server / internal services use x-internal-key
  if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
    req.isInternal = true;
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    // ── Instant ban check against DB ────────────────────────────
    const { getDB } = require('./db');
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT is_banned, ban_reason FROM users WHERE grudge_id = ? LIMIT 1',
      [req.user.grudge_id]
    );
    if (row?.is_banned) {
      return res.status(403).json({ error: row.ban_reason || 'Account banned' });
    }
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    next(err);
  }
}

// ── Routes ────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Grudge Studio — Game API</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#0a0e17;color:#c9a44a;font-family:system-ui,sans-serif}
    .card{text-align:center;padding:2rem}
    img{width:96px;height:96px;margin-bottom:1rem}
    h1{font-size:1.5rem;margin-bottom:.5rem;color:#e2c563}
    p{color:#8892a4;font-size:.9rem}
    a{color:#c9a44a;text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head><body>
  <div class="card">
    <img src="/favicon.png" alt="Grudge Studio">
    <h1>Grudge Studio — Game API</h1>
    <p>v2.0.0 &bull; <a href="/health">/health</a></p>
  </div>
</body></html>`);
});
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'game-api', version: '2.0.0' }));
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
app.use('/pvp',         requireAuth, pvpLimiter, pvpRoutes);

app.use((err, req, res, next) => {
  console.error('[game-api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

(async () => {
  await initDB();
  await initRedis();
  app.listen(PORT, () => console.log(`[game-api] Running on port ${PORT}`));
})();
