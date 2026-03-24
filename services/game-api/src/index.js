require('dotenv').config();
const path       = require('path');
const express    = require('express');
const helmet     = require('helmet');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
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
const gameDataRoutes   = require('./routes/game-data');
const dungeonRoutes    = require('./routes/dungeon');
const aiProxyRoutes    = require('./routes/ai-proxy');
const heroShipRoutes   = require('./routes/hero-ships');
const rtsConfigRoutes  = require('./routes/rts-config');
const rtsMatchRoutes   = require('./routes/rts-matches');
const campaignRoutes   = require('./routes/campaign');

const app = express();
const PORT = process.env.PORT || 3003;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7
const ADMIN_COOKIE_NAME = 'gs_admin_session';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, segment) => {
    const [rawKey, ...rest] = segment.trim().split('=');
    if (!rawKey || rest.length === 0) return acc;
    acc[rawKey] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function safeCompare(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createAdminSessionToken(secret) {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = `${expiresAt}.${crypto.randomBytes(8).toString('hex')}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyAdminSessionToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length < 3) return false;

  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const signature = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return safeCompare(signature, expected);
}

const { grudgeCors } = require('../../shared/cors');

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://static.cloudflareinsights.com"],
      connectSrc: ["'self'", "https://cloudflareinsights.com"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      fontSrc:    ["'self'"],
    },
  },
}));
app.use(grudgeCors());
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
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.post('/api/admin/login', (req, res) => {
  const submittedPasscode = String(req.body?.passcode || '');
  const expectedPasscode = process.env.ADMIN_PASSCODE;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET;

  if (!expectedPasscode || !sessionSecret) {
    return res.status(500).json({ authenticated: false, error: 'Admin auth not configured' });
  }

  if (!safeCompare(submittedPasscode, expectedPasscode)) {
    return res.status(401).json({ authenticated: false, error: 'Invalid credentials' });
  }

  const token = createAdminSessionToken(sessionSecret);
  const isProd = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) cookieParts.push('Secure');

  res.setHeader('Set-Cookie', cookieParts.join('; '));
  return res.json({ authenticated: true });
});
app.get('/api/admin/session', (req, res) => {
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!sessionSecret) {
    return res.status(500).json({ authenticated: false, error: 'Admin auth not configured' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token || !verifyAdminSessionToken(token, sessionSecret)) {
    return res.status(401).json({ authenticated: false });
  }

  return res.json({ authenticated: true });
});
app.post('/api/admin/logout', (_req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProd) cookieParts.push('Secure');

  res.setHeader('Set-Cookie', cookieParts.join('; '));
  return res.json({ success: true });
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
app.use('/pvp',         requireAuth, pvpLimiter, pvpRoutes);
app.use('/game-data',   gameDataRoutes);  // Public — no auth required (read-only game definitions)
app.use('/dungeon',     requireAuth, dungeonRoutes);
app.use('/ai',          requireAuth, aiProxyRoutes);
app.use('/hero-ship',   requireAuth, heroShipRoutes);
app.use('/rts-config',  rtsConfigRoutes);  // Read is public, write requires admin
app.use('/rts-matches', requireAuth, rtsMatchRoutes);
app.use('/campaign',    requireAuth, campaignRoutes);

app.use((err, req, res, next) => {
  console.error('[game-api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

(async () => {
  await initDB();
  await initRedis();
  app.listen(PORT, () => console.log(`[game-api] Running on port ${PORT}`));
})();
