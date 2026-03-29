require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { grudgeCors } = require('../shared/cors');

const authRoutes   = require('./routes/auth');
const identityRoutes = require('./routes/identity');
const deviceRoutes = require('./routes/device');
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
app.get('/', (req, res) => {
  // Browsers get the auth/device-pairing page; API clients get JSON
  const accept = (req.headers.accept || '').toLowerCase();
  if (accept.includes('text/html')) {
    return res.redirect('/device');
  }
  res.json({
    service: 'grudge-id',
    version: '1.1.0',
    description: 'Grudge Studio — Identity & Authentication',
    login: 'https://id.grudge-studio.com/device',
    endpoints: {
      health: 'GET /health',
      auth: {
        wallet: 'POST /auth/wallet',
        discord: 'GET /auth/discord',
        discord_callback: 'GET /auth/discord/callback',
        google: 'GET /auth/google',
        github: 'GET /auth/github',
        login: 'POST /auth/login',
        register: 'POST /auth/register',
        guest: 'POST /auth/guest',
        verify: 'POST /auth/verify',
        sso_check: 'GET /auth/sso-check?return=URL',
      },
      identity: {
        me: 'GET /identity/me (Bearer JWT)',
        update: 'PATCH /identity/me (Bearer JWT)',
      },
    },
    docs: 'https://github.com/MolochDaGod/grudge-studio-backend/blob/main/docs/API.md',
  });
});

// ♠️ GRUDA Node pages ────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
app.get('/device',  (req, res) => { sendHtmlPage(res, path.join(__dirname, '..', 'public', 'device.html'),  'https://grudge-studio.com/device'); });
app.get('/account', (req, res) => { sendHtmlPage(res, path.join(__dirname, '..', 'public', 'account.html'), 'https://grudge-studio.com/account'); });

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
app.use('/auth',     authLimiter, authRoutes);
app.use('/identity', identityRoutes);
app.use('/device',   deviceRoutes);

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
