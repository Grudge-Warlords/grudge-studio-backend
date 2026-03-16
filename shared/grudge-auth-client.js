/**
 * Grudge Auth Client — Universal proxy to id.grudge-studio.com
 *
 * Drop this into ANY project to get full Grudge authentication.
 * All auth flows (wallet, Discord, Google, GitHub, Puter, phone, guest,
 * username/password) are handled by the Grudge backend.
 *
 * On every new account, the backend creates:
 *   - A Grudge ID (UUID)
 *   - A Puter Cloud ID (GRUDGE-XXXXXXXX)
 *   - A server-side Solana wallet (HD derived)
 *
 * Usage (Express):
 *   const { mountGrudgeAuth, verifyGrudgeToken } = require('./grudge-auth-client');
 *   mountGrudgeAuth(app);                     // mounts /api/auth/* proxy routes
 *   app.get('/protected', verifyGrudgeToken, handler);  // JWT middleware
 *
 * Usage (standalone):
 *   const { grudgeLogin, grudgeRegister, grudgeVerify } = require('./grudge-auth-client');
 *   const result = await grudgeLogin('user', 'pass');
 */

const GRUDGE_AUTH_URL = process.env.GRUDGE_AUTH_URL
  || process.env.VPS_AUTH_URL
  || 'https://id.grudge-studio.com';

// ── Generic HTTP helpers ────────────────────────────────────────────────────

async function authPost(path, body = {}) {
  const res = await fetch(`${GRUDGE_AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function authGet(path, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GRUDGE_AUTH_URL}${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// ── Auth functions (call from anywhere) ─────────────────────────────────────

/** Username/email/grudge_id + password login */
async function grudgeLogin(username, password) {
  return authPost('/auth/login', { username, password });
}

/** Create new account (username + password, optional email) */
async function grudgeRegister(username, password, email) {
  return authPost('/auth/register', { username, password, email });
}

/** Guest login by device fingerprint */
async function grudgeGuest(deviceId) {
  return authPost('/auth/guest', { deviceId });
}

/** Web3Auth wallet login */
async function grudgeWallet(wallet_address, web3auth_token) {
  return authPost('/auth/wallet', { wallet_address, web3auth_token });
}

/** Discord OAuth code exchange */
async function grudgeDiscordExchange(code, redirect_uri) {
  return authPost('/auth/discord/exchange', { code, redirect_uri });
}

/** Google OAuth code exchange */
async function grudgeGoogleExchange(code, redirect_uri) {
  return authPost('/auth/google/exchange', { code, redirect_uri });
}

/** GitHub OAuth code exchange */
async function grudgeGitHubExchange(code, redirect_uri) {
  return authPost('/auth/github/exchange', { code, redirect_uri });
}

/** Puter UUID login/register */
async function grudgePuter(puterUuid, puterUsername, username) {
  return authPost('/auth/puter', { puterUuid, puterUsername, username });
}

/** Link Puter UUID to existing authenticated account */
async function grudgePuterLink(token, puterUuid, puterUsername) {
  const res = await fetch(`${GRUDGE_AUTH_URL}/auth/puter-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ puterUuid, puterUsername }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

/** Phone SMS OTP verification */
async function grudgePhoneVerify(phone, code) {
  return authPost('/auth/phone-verify', { phone, code });
}

/** Verify a Grudge JWT */
async function grudgeVerify(token) {
  return authPost('/auth/verify', { token });
}

/** Get identity by Grudge ID */
async function grudgeLookup(grudge_id) {
  return authGet(`/identity/${encodeURIComponent(grudge_id)}`);
}

/** Get own identity (requires token) */
async function grudgeGetMe(token) {
  return authGet('/identity/me', token);
}

// ── Extract user fields from any auth response ─────────────────────────────

function extractUser(data) {
  const user = data.user || data;
  return {
    grudgeId: data.grudgeId || user.grudgeId || user.grudge_id,
    username: data.username || user.username,
    displayName: user.displayName || user.display_name || user.username,
    email: user.email || null,
    discordId: user.discordId || user.discord_id || null,
    walletAddress: user.walletAddress || user.wallet_address || null,
    serverWalletAddress: user.serverWalletAddress || user.server_wallet_address || null,
    puterId: user.puter_id || user.puterId || null,
    isPremium: user.isPremium || false,
    isGuest: user.isGuest || user.is_guest || false,
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    faction: user.faction || null,
    race: user.race || null,
    class: user.class || null,
  };
}

// ── Express middleware: verify Grudge JWT ────────────────────────────────────

/**
 * Express middleware — verifies Bearer token against grudge-backend.
 * Attaches `req.grudgeUser` on success.
 * Tries local JWT verification first (if SESSION_SECRET is set), then
 * falls back to remote /auth/verify.
 */
async function verifyGrudgeToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7);

  // Try local JWT verify if we have the shared secret
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (secret) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, secret);
      if (decoded.grudge_id || decoded.grudgeId) {
        req.grudgeUser = {
          grudgeId: decoded.grudge_id || decoded.grudgeId,
          username: decoded.username || 'Player',
          userId: decoded.grudge_id || decoded.grudgeId,
          role: decoded.role,
          isPremium: decoded.isPremium,
          isGuest: decoded.isGuest || decoded.is_guest,
        };
        return next();
      }
    } catch (_) {
      // Fall through to remote verify
    }
  }

  // Remote verify against grudge-backend
  try {
    const result = await grudgeVerify(token);
    if (result.ok && result.data.valid && result.data.payload) {
      const p = result.data.payload;
      req.grudgeUser = {
        grudgeId: p.grudge_id || p.grudgeId,
        username: p.username || 'Player',
        userId: p.grudge_id || p.grudgeId,
        role: p.role,
        isPremium: p.isPremium,
        isGuest: p.is_guest || p.isGuest,
      };
      return next();
    }
  } catch (_) {}

  return res.status(401).json({ error: 'Invalid or expired token' });
}

/**
 * Optional auth — attaches req.grudgeUser if valid token present,
 * but doesn't fail without one.
 */
async function optionalGrudgeAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  const token = authHeader.substring(7);
  try {
    const result = await grudgeVerify(token);
    if (result.ok && result.data.valid && result.data.payload) {
      const p = result.data.payload;
      req.grudgeUser = {
        grudgeId: p.grudge_id || p.grudgeId,
        username: p.username || 'Player',
        userId: p.grudge_id || p.grudgeId,
      };
    }
  } catch (_) {}
  next();
}

// ── Express route mounter: proxy all /api/auth/* to grudge-backend ──────────

/**
 * Mount full auth proxy routes on an Express app.
 * Replaces any standalone auth — all traffic goes to id.grudge-studio.com.
 */
function mountGrudgeAuth(app) {
  // Proxy helper
  async function proxy(backendPath, req, res, opts = {}) {
    const { method = 'POST', forwardBody = true } = opts;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;

      const fetchOpts = { method, headers };
      if (forwardBody && method !== 'GET') {
        fetchOpts.body = JSON.stringify(req.body || {});
      }

      const upstream = await fetch(`${GRUDGE_AUTH_URL}${backendPath}`, fetchOpts);

      // Handle redirects (OAuth callbacks)
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get('location');
        if (location) return res.redirect(upstream.status, location);
      }

      const ct = upstream.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return res.status(upstream.status).json(await upstream.json());
      }
      return res.status(upstream.status).send(await upstream.text());
    } catch (err) {
      console.error(`[GrudgeAuth proxy ${backendPath}]`, err.message);
      res.status(502).json({ error: 'Grudge auth backend unavailable' });
    }
  }

  // POST auth endpoints
  app.post('/api/auth/login',    (req, res) => proxy('/auth/login', req, res));
  app.post('/api/auth/register', (req, res) => proxy('/auth/register', req, res));
  app.post('/api/auth/guest',    (req, res) => proxy('/auth/guest', req, res));
  app.post('/api/auth/wallet',   (req, res) => proxy('/auth/wallet', req, res));
  app.post('/api/auth/puter',    (req, res) => proxy('/auth/puter', req, res));
  app.post('/api/auth/puter-link', (req, res) => proxy('/auth/puter-link', req, res));
  app.post('/api/auth/verify',   (req, res) => proxy('/auth/verify', req, res));
  app.post('/api/auth/phone-verify', (req, res) => proxy('/auth/phone-verify', req, res));

  // OAuth exchanges
  app.post('/api/auth/discord/exchange', (req, res) => proxy('/auth/discord/exchange', req, res));
  app.post('/api/auth/google/exchange',  (req, res) => proxy('/auth/google/exchange', req, res));
  app.post('/api/auth/github/exchange',  (req, res) => proxy('/auth/github/exchange', req, res));

  // OAuth redirects
  app.get('/api/auth/discord', (req, res) => proxy('/auth/discord', req, res, { method: 'GET', forwardBody: false }));
  app.get('/api/auth/discord/callback', (req, res) => {
    const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
    proxy(`/auth/discord/callback?${qs}`, req, res, { method: 'GET', forwardBody: false });
  });

  // Identity
  app.get('/api/auth/me', (req, res) => proxy('/identity/me', req, res, { method: 'GET', forwardBody: false }));

  // Legacy aliases
  app.post('/api/login',    (req, res) => proxy('/auth/login', req, res));
  app.post('/api/register', (req, res) => proxy('/auth/register', req, res));
  app.post('/api/guest',    (req, res) => proxy('/auth/guest', req, res));

  console.log(`✅ Grudge Auth mounted → ${GRUDGE_AUTH_URL}`);
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Express integration
  mountGrudgeAuth,
  verifyGrudgeToken,
  optionalGrudgeAuth,

  // Standalone auth functions
  grudgeLogin,
  grudgeRegister,
  grudgeGuest,
  grudgeWallet,
  grudgeDiscordExchange,
  grudgeGoogleExchange,
  grudgeGitHubExchange,
  grudgePuter,
  grudgePuterLink,
  grudgePhoneVerify,
  grudgeVerify,
  grudgeLookup,
  grudgeGetMe,

  // Helpers
  extractUser,
  GRUDGE_AUTH_URL,
};
