require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { grudgeCors } = require('../shared/cors');

const authRoutes = require('./routes/auth');
const identityRoutes = require('./routes/identity');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Trust Cloudflare proxy (real IP, HTTPS detection, rate limit accuracy) ──
app.set('trust proxy', 1); // Trust one proxy hop (Traefik/Coolify) — required by express-rate-limit v7
// ── Security middleware ───────────────────────
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false, // CSP set per-route on HTML pages
}));
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

// ── GRUDA Node device pairing page ───────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
app.get('/device', (req, res) => { sendHtmlPage(res, path.join(__dirname, '..', 'public', 'device.html'), 'https://grudge-studio.com/device'); });

// ?? HTML page CSP (allows inline scripts + Google Fonts) ?????????????????????
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://js.puter.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://api.grudge-studio.com https://id.grudge-studio.com https://api.puter.com https://*.puter.com wss://*.puter.com",
  "frame-ancestors 'none'",
].join('; ');

function sendHtmlPage(res, filePath, fallbackUrl) {
  res.setHeader('Content-Security-Policy', HTML_CSP);
  if (require('fs').existsSync(filePath)) return res.sendFile(filePath);
  res.redirect(fallbackUrl);
}

// ?? Favicon ???????????????????????????????????????????????????????????????????
app.get('/favicon.ico', (req, res) => {
  // Transparent 1x1 ICO to silence 404s
  const ico = Buffer.from('AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64');
  res.setHeader('Content-Type', 'image/x-icon');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(ico);
});

// ?? Legal pages ???????????????????????????????????????????????????????????????
app.get('/tos', (req, res) => { sendHtmlPage(res, path.join(__dirname, '..', 'public', 'tos.html'), 'https://grudge-studio.com/tos'); });
app.get('/privacy', (req, res) => { sendHtmlPage(res, path.join(__dirname, '..', 'public', 'privacy.html'), 'https://grudge-studio.com/privacy'); });

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
