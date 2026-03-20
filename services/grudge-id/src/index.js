require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { grudgeCors } = require('../../shared/cors');

const authRoutes = require('./routes/auth');
const identityRoutes = require('./routes/identity');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Trust Cloudflare proxy (real IP, HTTPS detection, rate limit accuracy) ──
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7
// ── Security middleware ───────────────────────
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }));
// ── Dynamic CORS — shared module allows all Grudge subdomains, Vercel previews, Puter apps ─
app.use(grudgeCors());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ─────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many requests, slow down.' },
});

// ── Routes ────────────────────────────────────
app.get('/', (req, res) => res.json({
  service: 'grudge-id',
  version: '1.0.0',
  description: 'Grudge Studio — Identity & Authentication API',
  endpoints: {
    health: 'GET /health',
    auth: {
      wallet: 'POST /auth/wallet',
      discord: 'GET /auth/discord',
      discord_callback: 'GET /auth/discord/callback',
      login: 'POST /auth/login',
      register: 'POST /auth/register',
      guest: 'POST /auth/guest',
      verify: 'POST /auth/verify',
    },
    identity: {
      me: 'GET /identity/me (Bearer JWT)',
      update: 'PATCH /identity/me (Bearer JWT)',
    },
  },
  docs: 'https://github.com/MolochDaGod/grudge-studio-backend/blob/main/docs/API.md',
}));
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
