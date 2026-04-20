require('dotenv').config();
require('../../shared/validate-env')(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS']);

let Sentry;
if (process.env.SENTRY_DSN) {
  try { Sentry = require('@sentry/node'); Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'production', tracesSampleRate: 0.05 }); console.log('[account-api] Sentry enabled'); } catch (e) { console.warn('[account-api] Sentry init failed:', e.message); }
}

const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB, getPool, deepCheck } = require('./db');

const profileRoutes      = require('./routes/profile');
const friendRoutes       = require('./routes/friends');
const notifRoutes        = require('./routes/notifications');
const achievementRoutes  = require('./routes/achievements');
const sessionRoutes      = require('./routes/sessions');
const puterRoutes        = require('./routes/puter');

const app  = express();
const PORT = process.env.PORT || 3005;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7

const { grudgeCors } = require('../../shared/cors');

app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }));
app.use(grudgeCors());
app.use(express.json({ limit: '2mb' }));

// ── Rate limiting ─────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests, slow down.' },
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Upload limit reached, try again later.' },
});

app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const dbResult = await deepCheck();
  const status = dbResult.ok ? 'ok' : 'down';
  res.status(dbResult.ok ? 200 : 503).json({
    status,
    service: 'account-api',
    version: '1.0.0',
    db: { ok: dbResult.ok, ms: dbResult.ms, error: dbResult.error || undefined },
  });
});

// profile/:grudge_id — public GET, auth-gated PATCH; avatar POST has its own limiter
app.use('/profile', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/avatar') return uploadLimiter(req, res, next);
  next();
}, profileRoutes);

app.use('/friends',       friendRoutes);
app.use('/notifications', notifRoutes);
app.use('/achievements',  achievementRoutes);
app.use('/sessions',      sessionRoutes);
app.use('/puter',         puterRoutes);

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  if (Sentry) Sentry.captureException(err);
  console.error('[account-api]', err.message);
  const status = err.status || (err.message?.includes('Only image') ? 400 : 500);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start + graceful shutdown ──────────────────────
(async () => {
  await initDB();
  const server = app.listen(PORT, () => console.log(`[account-api] Running on port ${PORT}`));

  function shutdown(signal) {
    console.log(`[account-api] ${signal} — shutting down gracefully`);
    server.close(async () => {
      try { await getPool()?.end(); } catch {}
      process.exit(0);
    });
    setTimeout(() => { console.error('[account-api] Forced exit after timeout'); process.exit(1); }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
})();
