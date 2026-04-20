require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const manifestRoutes  = require('./routes/manifest');
const versionsRoutes  = require('./routes/versions');
const computersRoutes = require('./routes/computers');
const launchRoutes    = require('./routes/launch');

const app  = express();
const PORT = process.env.PORT || 3006;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7

const { grudgeCors } = require('../../shared/cors');

app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }));
app.use(grudgeCors());
app.use(express.json({ limit: '512kb' }));

// ── Rate limiting ─────────────────────────────────────────────────
// Launch token requests are per-user and must be strict to prevent abuse.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests.' },
});
const launchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 min window
  max: 10,                   // 10 launch tokens per 5 min
  message: { error: 'Launch token rate limit exceeded.' },
});

app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'launcher-api', version: '1.0.0' })
);

app.use('/manifest',  manifestRoutes);
app.use('/versions',  versionsRoutes);
app.use('/',          computersRoutes);    // POST /register-computer
app.use('/', launchLimiter, launchRoutes); // POST /launch-token, GET /validate-launch-token, GET /entitlement

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[launcher-api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
(async () => {
  await initDB();
  app.listen(PORT, () => console.log(`[launcher-api] Running on port ${PORT}`));
})();
