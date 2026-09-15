require('dotenv').config();

const { validateCanonicalDB } = require('../../shared/validate-env');
validateCanonicalDB({ serviceName: 'asset-service' });

const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const assetRoutes = require('./routes/assets');

const app  = express();
const PORT = process.env.PORT || 3008;
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7

const { grudgeCors } = require('../../shared/cors');

app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }));
app.use(grudgeCors());
app.use(express.json({ limit: '2mb' }));

// ── Rate limiting ─────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, slow down.' },
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Upload limit reached, try again later.' },
});

app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'asset-service', version: '1.0.0' })
);

app.use('/assets', (req, res, next) => {
  if (req.method === 'POST') return uploadLimiter(req, res, next);
  next();
}, assetRoutes);

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[asset-service]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
(async () => {
  await initDB();
  app.listen(PORT, () => console.log(`[asset-service] Running on port ${PORT}`));
})();
