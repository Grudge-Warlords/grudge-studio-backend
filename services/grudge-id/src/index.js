require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const identityRoutes = require('./routes/identity');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security middleware ───────────────────────
app.use(helmet());
// ── Dynamic CORS — add GitHub Pages / puter app URLs to CORS_ORIGINS env ─
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  'https://grudgewarlords.com,https://grudgestudio.com,https://grudachain.grudgestudio.com,https://app.puter.com'
).split(',').map(o => o.trim()).filter(Boolean);
// Allow all *.puter.site subdomains for Puter-hosted apps
const CORS_ORIGIN_FN = (origin, cb) => {
  if (!origin) return cb(null, true); // server-to-server
  if (CORS_ORIGINS.includes(origin) || /\.puter\.site$/.test(origin)) {
    return cb(null, true);
  }
  cb(new Error('CORS: origin not allowed'));
};
if (process.env.NODE_ENV !== 'production') {
  CORS_ORIGINS.push('http://localhost:3000', 'http://localhost:5173');
}
app.use(cors({ origin: CORS_ORIGIN_FN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ─────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many requests, slow down.' },
});

// ── Routes ────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'grudge-id' }));
app.use('/auth', authLimiter, authRoutes);
app.use('/identity', identityRoutes);

// ── Error handler ─────────────────────────────
app.use((err, req, res, next) => {
  console.error('[grudge-id]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`[grudge-id] Running on port ${PORT}`);
  });
})();
