require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const profileRoutes      = require('./routes/profile');
const friendRoutes       = require('./routes/friends');
const notifRoutes        = require('./routes/notifications');
const achievementRoutes  = require('./routes/achievements');
const sessionRoutes      = require('./routes/sessions');
const puterRoutes        = require('./routes/puter');

const app  = express();
const PORT = process.env.PORT || 3005;
app.set('trust proxy', true);

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
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'account-api', version: '1.0.0' })
);

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

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[account-api]', err.message);
  const status = err.status || (err.message?.includes('Only image') ? 400 : 500);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
(async () => {
  await initDB();
  app.listen(PORT, () => console.log(`[account-api] Running on port ${PORT}`));
})();
