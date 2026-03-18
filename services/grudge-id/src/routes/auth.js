const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { getDB } = require('../db');
const { verifyTurnstile } = require('../middleware/turnstile');
const { isAllowedRedirect, DEFAULT_AUTH_REDIRECT } = require('../../../shared/cors');

const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN || '7d';
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL;
const INTERNAL_API_KEY   = process.env.INTERNAL_API_KEY;

// ── OAuth state helpers (encode redirect_uri into provider state param) ──────
function encodeOAuthState(redirect_uri) {
  const payload = { redirect_uri: redirect_uri || DEFAULT_AUTH_REDIRECT, nonce: crypto.randomBytes(8).toString('hex') };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeOAuthState(state) {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    // Validate the redirect_uri against our allow-list
    if (parsed.redirect_uri && isAllowedRedirect(parsed.redirect_uri)) {
      return parsed.redirect_uri;
    }
  } catch {}
  return DEFAULT_AUTH_REDIRECT;
}

// ── SSO cookie helper ─────────────────────────
const SSO_COOKIE_NAME = 'grudge_sso';
const SSO_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (match JWT)
};

function setSsoCookie(res, token) {
  res.cookie(SSO_COOKIE_NAME, token, SSO_COOKIE_OPTS);
}

// ── Web3Auth JWKS cache ───────────────────────
let _jwksCache = null;
let _jwksCachedAt = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getWeb3AuthJWKS() {
  if (_jwksCache && Date.now() - _jwksCachedAt < JWKS_CACHE_TTL) return _jwksCache;
  const resp = await axios.get('https://api.openlogin.com/jwks', { timeout: 5000 });
  _jwksCache = resp.data.keys;
  _jwksCachedAt = Date.now();
  return _jwksCache;
}

async function verifyWeb3AuthToken(web3auth_token, expected_wallet) {
  if (!web3auth_token) return false;
  try {
    const keys = await getWeb3AuthJWKS();
    for (const jwk of keys) {
      try {
        const decoded = jwt.verify(web3auth_token, { format: 'jwk', key: jwk }, {
          algorithms: ['ES256', 'RS256'],
        });
        // Web3Auth embeds wallet in wallets array or top-level fields
        const claimedWallet =
          decoded.wallets?.[0]?.public_key ||
          decoded.wallet_address ||
          decoded.public_key;
        if (!claimedWallet) continue;
        if (claimedWallet.toLowerCase() !== expected_wallet.toLowerCase()) return false;
        return true;
      } catch { continue; }
    }
    return false;
  } catch (e) {
    console.warn('[grudge-id] Web3Auth JWKS error:', e.message);
    return false;
  }
}

// ── Helper: issue Grudge JWT ──────────────────
function issueToken(user) {
  return jwt.sign(
    {
      grudge_id: user.grudge_id,
      username: user.username,
      discord_id: user.discord_id,
      wallet_address: user.wallet_address,
      server_wallet_address: user.server_wallet_address,
      puter_id: user.puter_id,
      faction: user.faction,
      race: user.race,
      class: user.class,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// ── Helper: get or create user + server wallet ─
async function getOrCreateUser(db, identityField, identityValue, extraFields = {}) {
  let [rows] = await db.query(
    `SELECT * FROM users WHERE ${identityField} = ? LIMIT 1`,
    [identityValue]
  );

  if (rows.length > 0) {
    const user = rows[0];
    // ── Ban check ─────────────────────────────
    if (user.is_banned) {
      const err = new Error(user.ban_reason || 'Account banned');
      err.status = 403;
      err.banned = true;
      throw err;
    }
    await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    return user;
  }

  // New user - create Grudge ID
  const grudge_id = uuidv4();

  // Request server-side wallet from wallet-service
  let server_wallet_address = null;
  let server_wallet_index = null;
  try {
    const resp = await axios.post(
      `${WALLET_SERVICE_URL}/wallet/create`,
      { grudge_id },
      { headers: { 'x-internal-key': INTERNAL_API_KEY } }
    );
    server_wallet_address = resp.data.address;
    server_wallet_index = resp.data.index;
  } catch (e) {
    console.warn('[grudge-id] wallet-service unavailable:', e.message);
  }

  // Generate puter_id
  const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;

  await db.query(
    `INSERT INTO users
      (grudge_id, puter_id, server_wallet_address, server_wallet_index, last_login, ${identityField}, ${Object.keys(extraFields).join(', ')})
     VALUES (?, ?, ?, ?, NOW(), ?, ${Object.keys(extraFields).map(() => '?').join(', ')})`,
    [grudge_id, puter_id, server_wallet_address, server_wallet_index, identityValue, ...Object.values(extraFields)]
  );

  [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
  return rows[0];
}

// ── POST /auth/wallet ─────────────────────────
// Web3Auth: client sends verified wallet address + Web3Auth token
// Turnstile: bot protection (free, unlimited — enabled in production)
router.post('/wallet', verifyTurnstile, async (req, res, next) => {
  try {
    const { wallet_address, web3auth_token } = req.body;
    if (!wallet_address) return res.status(400).json({ error: 'wallet_address required' });

    // ── Web3Auth JWKS verification ───────────
    if (web3auth_token) {
      const valid = await verifyWeb3AuthToken(web3auth_token, wallet_address);
      if (!valid) {
        return res.status(401).json({ error: 'Web3Auth token verification failed' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'web3auth_token required' });
    }

    const db = getDB();
    const user = await getOrCreateUser(db, 'wallet_address', wallet_address);
    const token = issueToken(user);
    setSsoCookie(res, token);

    res.json({
      token, grudge_id: user.grudge_id, puter_id: user.puter_id });
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── GET /auth/discord ─────────────────────
// Redirect to Discord OAuth. Accepts ?redirect_uri= to return the user
// to the correct app after login (encoded in OAuth state param).
router.get('/discord', (req, res) => {
  const state = encodeOAuthState(req.query.redirect_uri);
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ── GET /auth/discord/start ───────────────
// Frontend-initiated: returns JSON { url } instead of 302.
// Accepts ?redirect_uri= to route the user back to the correct app after login.
router.get('/discord/start', (req, res) => {
  const state = encodeOAuthState(req.query.redirect_uri || req.query.state);
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'Discord OAuth not configured' });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  res.json({ url: `https://discord.com/api/oauth2/authorize?${params}` });
});

// ── GET /auth/google/start ────────────────
router.get('/google/start', (req, res) => {
  const state = encodeOAuthState(req.query.redirect_uri || req.query.state);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'Google OAuth not configured' });
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `https://id.grudge-studio.com/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// ── GET /auth/github/start ────────────────
router.get('/github/start', (req, res) => {
  const state = encodeOAuthState(req.query.redirect_uri || req.query.state);
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'GitHub OAuth not configured' });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.GITHUB_REDIRECT_URI || `https://id.grudge-studio.com/auth/github/callback`,
    scope: 'read:user user:email',
    state,
  });
  res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});

// ── GET /auth/discord/callback ────────────────
// Discord redirects here after user approves. We decode the state param
// to determine which app to send the user back to.
router.get('/discord/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    const returnUrl = state || 'https://grudgewarlords.com/';

    // Decode redirect_uri from state (falls back to DEFAULT_AUTH_REDIRECT)
    const appRedirect = decodeOAuthState(state || '');

    // Exchange code for token
    const tokenResp = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResp.data;

    // Fetch Discord user
    const userResp = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const { id: discord_id, username, discriminator, email } = userResp.data;
    const discord_tag = discriminator !== '0' ? `${username}#${discriminator}` : username;

    const db = getDB();
    const user = await getOrCreateUser(db, 'discord_id', discord_id, {
      discord_tag,
      ...(email ? { email } : {}),
    });

    const token = issueToken(user);
    setSsoCookie(res, token);

    // Redirect to the calling app (or default) with token
    const sep = appRedirect.includes('?') ? '&' : '?';
    res.redirect(`${appRedirect}${sep}token=${token}&grudge_id=${user.grudge_id}&provider=discord`);
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});
// ── POST /auth/verify ─────────────────────────
// Verify a Grudge JWT and return the payload
router.post('/verify', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, payload });
  } catch {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

// ── GET /auth/user ────────────────────────────
// Returns current user profile from JWT Bearer token.
// Used by useAuth() hook on all frontends.
router.get('/user', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    let decoded;
    try {
      decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const db = getDB();
    const [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [decoded.grudge_id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });

    res.json({
      id: user.id,
      grudgeId: user.grudge_id,
      username: user.username,
      displayName: user.display_name || user.username,
      email: user.email || null,
      avatarUrl: user.avatar_url || null,
      isPremium: false,
      isGuest: !!user.is_guest,
      gold: user.gold || 1000,
      gbuxBalance: user.gbux_balance || 0,
      walletAddress: user.wallet_address || null,
      serverWalletAddress: user.server_wallet_address || null,
      faction: user.faction || null,
      race: user.race || null,
      class: user.class || null,
    });
  } catch (err) { next(err); }
});

// Also support GET /auth/me as alias
router.get('/me', (req, res, next) => {
  req.url = '/user';
  router.handle(req, res, next);
});

// Also support GET /auth/verify via Bearer token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, error: 'No token' });
    }
    const payload = jwt.verify(authHeader.substring(7), JWT_SECRET);
    res.json({ valid: true, payload });
  } catch {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

// ── POST /auth/phone-send ─────────────────────
// Send SMS verification code via Twilio Verify
router.post('/phone-send', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const normalized = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const verifySid  = process.env.TWILIO_VERIFY_SID;
    if (!accountSid || !authToken || !verifySid) {
      return res.status(503).json({ error: 'Phone auth not configured' });
    }

    const twilioResp = await axios.post(
      `https://verify.twilio.com/v2/Services/${verifySid}/Verifications`,
      new URLSearchParams({ To: normalized, Channel: 'sms' }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: accountSid, password: authToken },
      }
    );

    if (twilioResp.data.status === 'pending') {
      res.json({ success: true, message: 'Verification code sent' });
    } else {
      res.status(400).json({ error: 'Failed to send verification code' });
    }
  } catch (err) {
    console.error('[grudge-id] phone-send error:', err.message);
    next(err);
  }
});

// ── POST /auth/login ──────────────────────────
// Username/email/grudge_id + password login
router.post('/login', verifyTurnstile, async (req, res, next) => {
  try {
    const { username, identifier, password } = req.body;
    const loginId = identifier || username;
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM users
       WHERE username = ? OR email = ? OR grudge_id = ?
       LIMIT 1`,
      [loginId, loginId, loginId]
    );

    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: user.ban_reason || 'Account banned' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    const token = issueToken(user);
    setSsoCookie(res, token);

    res.json({
      success: true,
      token,
      grudgeId: user.grudge_id,
      username: user.username,
      user: {
        id: user.id,
        grudgeId: user.grudge_id,
        username: user.username,
        displayName: user.display_name || user.username,
        email: user.email,
        isPremium: false,
        isGuest: !!user.is_guest,
        gold: user.gold ?? 1000,
        gbuxBalance: user.gbux_balance || 0,
        walletAddress: user.wallet_address,
        serverWalletAddress: user.server_wallet_address,
        faction: user.faction,
        race: user.race,
        class: user.class,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /auth/register
router.post('/register', verifyTurnstile, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const db = getDB();

    // Check uniqueness
    const [existing] = await db.query(
      'SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?) LIMIT 1',
      [username, email || '']
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const grudge_id = uuidv4();
    const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;
    const password_hash = await bcrypt.hash(password, 10);

    // Server wallet
    let server_wallet_address = null;
    let server_wallet_index = null;
    try {
      const resp = await axios.post(
        `${WALLET_SERVICE_URL}/wallet/create`,
        { grudge_id },
        { headers: { 'x-internal-key': INTERNAL_API_KEY } }
      );
      server_wallet_address = resp.data.address;
      server_wallet_index = resp.data.index;
    } catch (e) {
      console.warn('[grudge-id] wallet-service unavailable:', e.message);
    }

    await db.query(
      `INSERT INTO users
        (grudge_id, puter_id, username, email, password_hash, display_name,
         server_wallet_address, server_wallet_index, is_guest, gold, gbux_balance, last_login)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, 1000, 0, NOW())`,
      [grudge_id, puter_id, username, email || null, password_hash, username,
       server_wallet_address, server_wallet_index]
    );

    const [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
    const user = rows[0];
    const token = issueToken(user);
    setSsoCookie(res, token);

    res.status(201).json({
      success: true,
      token,
      grudgeId: user.grudge_id,
      username: user.username,
      isNewUser: true,
      message: `Welcome to GRUDGE Warlords! Your GRUDGE ID: ${user.grudge_id}`,
      user: {
        id: user.id,
        grudgeId: user.grudge_id,
        username: user.username,
        displayName: user.display_name || user.username,
        email: user.email,
        isPremium: false,
        isGuest: false,
        gold: user.gold || 1000,
        gbuxBalance: user.gbux_balance || 0,
        walletAddress: user.wallet_address,
        serverWalletAddress: user.server_wallet_address,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /auth/guest ──────────────────────────
router.post('/guest', async (req, res, next) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

    const guestUsername = `guest_${deviceId.slice(0, 12)}`;
    const db = getDB();

    const [existing] = await db.query(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [guestUsername]
    );

    let user = existing[0];
    let isNewUser = false;

    if (!user) {
      const grudge_id = uuidv4();
      const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;

      await db.query(
        `INSERT INTO users
          (grudge_id, puter_id, username, display_name, password_hash, is_guest, gold, gbux_balance, last_login)
         VALUES (?, ?, ?, ?, 'guest', TRUE, 500, 0, NOW())`,
        [grudge_id, puter_id, guestUsername, `Guest ${deviceId.slice(0, 6)}`]
      );

      const [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
      user = rows[0];
      isNewUser = true;
    } else {
      await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    }

    const token = issueToken(user);
    setSsoCookie(res, token);

    res.status(isNewUser ? 201 : 200).json({
      success: true,
      token,
      grudgeId: user.grudge_id,
      username: user.username,
      isGuest: true,
      isNewUser,
      user: {
        id: user.id,
        grudgeId: user.grudge_id,
        username: user.username,
        displayName: user.display_name || user.username,
        isPremium: false,
        isGuest: true,
        gold: user.gold || 500,
        gbuxBalance: user.gbux_balance || 0,
      },
    });
  } catch (err) { next(err); }
});

// ── Helper: standard auth response ────────────
function formatAuthResponse(user, token, isNewUser = false) {
  return {
    success: true,
    token,
    grudgeId: user.grudge_id,
    userId: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    email: user.email || null,
    avatarUrl: user.avatar_url || null,
    isPremium: false,
    gold: user.gold || 1000,
    gbuxBalance: user.gbux_balance || 0,
    walletAddress: user.wallet_address || null,
    isNewAccount: isNewUser,
    isNewUser,
    user: {
      id: user.id,
      grudgeId: user.grudge_id,
      username: user.username,
      displayName: user.display_name || user.username,
      email: user.email || null,
      isPremium: false,
      isGuest: !!user.is_guest,
      gold: user.gold || 1000,
      gbuxBalance: user.gbux_balance || 0,
      walletAddress: user.wallet_address || null,
      serverWalletAddress: user.server_wallet_address || null,
      avatarUrl: user.avatar_url || null,
      faction: user.faction || null,
      race: user.race || null,
      class: user.class || null,
    },
  };
}

// ── POST /auth/discord/exchange ───────────────
// Direct code exchange (used by platform proxy)
router.post('/discord/exchange', async (req, res, next) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    const tokenResp = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect_uri || process.env.DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResp.data;
    if (!access_token) return res.status(401).json({ error: 'Discord token exchange failed' });

    const userResp = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const du = userResp.data;
    if (!du.id) return res.status(401).json({ error: 'Failed to fetch Discord user' });

    const discord_tag = du.discriminator !== '0' ? `${du.username}#${du.discriminator}` : du.username;
    const avatarUrl = du.avatar
      ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    const db = getDB();
    const user = await getOrCreateUser(db, 'discord_id', du.id, {
      discord_tag,
      ...(du.email ? { email: du.email } : {}),
    });

    // Update avatar
    await db.query('UPDATE users SET avatar_url = ? WHERE grudge_id = ?', [avatarUrl, user.grudge_id]).catch(() => {});
    user.avatar_url = avatarUrl;

    const token = issueToken(user);
    res.json(formatAuthResponse(user, token, !user.last_login));
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── POST /auth/puter ──────────────────────────
// Puter UUID login/register
router.post('/puter', async (req, res, next) => {
  try {
    const { puterUuid, puterUsername, username } = req.body;
    if (!puterUuid) return res.status(400).json({ error: 'Puter UUID required' });

    const db = getDB();

    // Check if user exists by puter_uuid
    let [rows] = await db.query('SELECT * FROM users WHERE puter_uuid = ? LIMIT 1', [puterUuid]);
    let user = rows[0];
    let isNewUser = false;

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    } else {
      // Create new user
      isNewUser = true;
      const grudge_id = uuidv4();
      const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;
      const finalUsername = username || puterUsername || `puter_${puterUuid.slice(0, 8)}`;
      const displayName = puterUsername || finalUsername;

      // Server wallet
      let server_wallet_address = null;
      let server_wallet_index = null;
      try {
        const resp = await axios.post(
          `${WALLET_SERVICE_URL}/wallet/create`,
          { grudge_id },
          { headers: { 'x-internal-key': INTERNAL_API_KEY } }
        );
        server_wallet_address = resp.data.address;
        server_wallet_index = resp.data.index;
      } catch (e) {
        console.warn('[grudge-id] wallet-service unavailable:', e.message);
      }

      await db.query(
        `INSERT INTO users
          (grudge_id, puter_id, puter_uuid, puter_username, username, display_name,
           server_wallet_address, server_wallet_index, is_guest, gold, gbux_balance, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, 1000, 100, NOW())`,
        [grudge_id, puter_id, puterUuid, puterUsername || null, finalUsername, displayName,
         server_wallet_address, server_wallet_index]
      );

      [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
      user = rows[0];
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    res.status(isNewUser ? 201 : 200).json(formatAuthResponse(user, token, isNewUser));
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── POST /auth/puter-link
// Link Puter UUID to an existing authenticated account
router.post('/puter-link', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { puterUuid, puterUsername } = req.body;
    if (!puterUuid) return res.status(400).json({ error: 'puterUuid required' });

    const db = getDB();

    // Check for conflicts
    const [conflict] = await db.query(
      'SELECT id FROM users WHERE puter_uuid = ? AND grudge_id != ? LIMIT 1',
      [puterUuid, decoded.grudge_id]
    );
    if (conflict.length > 0) {
      return res.status(409).json({ error: 'Puter account already linked to another Grudge ID' });
    }

    await db.query(
      'UPDATE users SET puter_uuid = ?, puter_username = ? WHERE grudge_id = ?',
      [puterUuid, puterUsername || null, decoded.grudge_id]
    );

    res.json({ success: true, message: 'Puter cloud ID linked to your account' });
  } catch (err) { next(err); }
});

// ── POST /auth/google/exchange ────────────────
// Google OAuth code exchange (used by platform proxy)
router.post('/google/exchange', async (req, res, next) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    const tokenResp = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect_uri || process.env.GOOGLE_REDIRECT_URI || '',
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenResp.data;
    if (!access_token) return res.status(401).json({ error: 'Google token exchange failed' });

    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const gu = userResp.data;
    if (!gu.id) return res.status(401).json({ error: 'Failed to get Google user info' });

    const db = getDB();

    // Check by google_id first, then by email
    let [rows] = await db.query(
      'SELECT * FROM users WHERE google_id = ? LIMIT 1', [gu.id]
    );
    let user = rows[0];
    let isNewUser = false;

    if (!user && gu.email) {
      [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [gu.email]);
      user = rows[0];
      if (user) {
        await db.query('UPDATE users SET google_id = ? WHERE grudge_id = ?', [gu.id, user.grudge_id]).catch(() => {});
      }
    }

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query(
        'UPDATE users SET last_login = NOW(), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gu.picture || null, user.grudge_id]
      );
    } else {
      isNewUser = true;
      const grudge_id = uuidv4();
      const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;
      let username = `g_${(gu.name || '').replace(/\s+/g, '').slice(0, 16)}` || `google_${gu.id.slice(0, 8)}`;

      const [taken] = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (taken.length > 0) username = `google_${gu.id.slice(0, 10)}`;

      const password_hash = await bcrypt.hash(uuidv4(), 10);

      let server_wallet_address = null;
      let server_wallet_index = null;
      try {
        const resp = await axios.post(
          `${WALLET_SERVICE_URL}/wallet/create`, { grudge_id },
          { headers: { 'x-internal-key': INTERNAL_API_KEY } }
        );
        server_wallet_address = resp.data.address;
        server_wallet_index = resp.data.index;
      } catch (e) { console.warn('[grudge-id] wallet-service unavailable:', e.message); }

      await db.query(
        `INSERT INTO users
          (grudge_id, puter_id, username, display_name, email, avatar_url,
           google_id, password_hash, server_wallet_address, server_wallet_index,
           is_guest, gold, gbux_balance, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, 1000, 0, NOW())`,
        [grudge_id, puter_id, username, gu.name || username, gu.email || null,
         gu.picture || null, gu.id, password_hash,
         server_wallet_address, server_wallet_index]
      );

      [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
      user = rows[0];
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    res.json(formatAuthResponse(user, token, isNewUser));
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── POST /auth/github/exchange
// GitHub OAuth code exchange (used by platform proxy)
router.post('/github/exchange', async (req, res, next) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirect_uri || process.env.GITHUB_REDIRECT_URI || '',
      },
      { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }
    );
    const { access_token } = tokenResp.data;
    if (!access_token) return res.status(401).json({ error: 'GitHub token exchange failed' });

    const [userResp, emailResp] = await Promise.all([
      axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
      }),
      axios.get('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
      }).catch(() => ({ data: [] })),
    ]);

    const gh = userResp.data;
    if (!gh.id) return res.status(401).json({ error: 'Failed to get GitHub user info' });

    let primaryEmail = gh.email;
    try {
      const primary = emailResp.data.find(e => e.primary && e.verified);
      if (primary) primaryEmail = primary.email;
    } catch (_) {}

    const db = getDB();
    const ghIdStr = String(gh.id);

    let [rows] = await db.query('SELECT * FROM users WHERE github_id = ? LIMIT 1', [ghIdStr]);
    let user = rows[0];
    let isNewUser = false;

    if (!user && primaryEmail) {
      [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [primaryEmail]);
      user = rows[0];
      if (user) {
        await db.query('UPDATE users SET github_id = ? WHERE grudge_id = ?', [ghIdStr, user.grudge_id]).catch(() => {});
      }
    }

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query(
        'UPDATE users SET last_login = NOW(), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gh.avatar_url || null, user.grudge_id]
      );
    } else {
      isNewUser = true;
      const grudge_id = uuidv4();
      const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;
      let username = `gh_${(gh.login || '').slice(0, 16)}` || `github_${ghIdStr.slice(0, 8)}`;

      const [taken] = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
      if (taken.length > 0) username = `github_${ghIdStr.slice(0, 10)}`;

      const password_hash = await bcrypt.hash(uuidv4(), 10);

      let server_wallet_address = null;
      let server_wallet_index = null;
      try {
        const resp = await axios.post(
          `${WALLET_SERVICE_URL}/wallet/create`, { grudge_id },
          { headers: { 'x-internal-key': INTERNAL_API_KEY } }
        );
        server_wallet_address = resp.data.address;
        server_wallet_index = resp.data.index;
      } catch (e) { console.warn('[grudge-id] wallet-service unavailable:', e.message); }

      await db.query(
        `INSERT INTO users
          (grudge_id, puter_id, username, display_name, email, avatar_url,
           github_id, password_hash, server_wallet_address, server_wallet_index,
           is_guest, gold, gbux_balance, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, 1000, 0, NOW())`,
        [grudge_id, puter_id, username, gh.name || username, primaryEmail || null,
         gh.avatar_url || null, ghIdStr, password_hash,
         server_wallet_address, server_wallet_index]
      );

      [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
      user = rows[0];
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    res.json(formatAuthResponse(user, token, isNewUser));
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── GET /auth/google ──────────────────────
// Redirect to Google OAuth. Accepts ?redirect_uri= for dynamic app redirect.
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });
  const state = encodeOAuthState(req.query.redirect_uri);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'https://id.grudge-studio.com/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── GET /auth/google/callback ───────────────
router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    const appRedirect = decodeOAuthState(state || '');

    const tokenResp = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'https://id.grudge-studio.com/auth/google/callback',
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenResp.data;
    if (!access_token) return res.status(401).json({ error: 'Google token exchange failed' });

    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const gu = userResp.data;
    if (!gu.id) return res.status(401).json({ error: 'Failed to get Google user info' });

    const db = getDB();
    let [rows] = await db.query('SELECT * FROM users WHERE google_id = ? LIMIT 1', [gu.id]);
    let user = rows[0];

    if (!user && gu.email) {
      [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [gu.email]);
      user = rows[0];
      if (user) await db.query('UPDATE users SET google_id = ? WHERE grudge_id = ?', [gu.id, user.grudge_id]).catch(() => {});
    }

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query(
        'UPDATE users SET last_login = NOW(), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gu.picture || null, user.grudge_id]
      );
    } else {
      user = await getOrCreateUser(db, 'google_id', gu.id, {
        ...(gu.email ? { email: gu.email } : {}),
      });
      await db.query(
        'UPDATE users SET display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gu.name || null, gu.picture || null, user.grudge_id]
      ).catch(() => {});
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    const sep = appRedirect.includes('?') ? '&' : '?';
    res.redirect(`${appRedirect}${sep}token=${token}&grudge_id=${user.grudge_id}&provider=google`);
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── GET /auth/github ──────────────────────
// Redirect to GitHub OAuth. Accepts ?redirect_uri= for dynamic app redirect.
router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(503).json({ error: 'GitHub OAuth not configured' });
  const state = encodeOAuthState(req.query.redirect_uri);
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_REDIRECT_URI || 'https://id.grudge-studio.com/auth/github/callback',
    scope: 'read:user user:email',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ── GET /auth/github/callback ───────────────
router.get('/github/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    const appRedirect = decodeOAuthState(state || '');

    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI || 'https://id.grudge-studio.com/auth/github/callback',
      },
      { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }
    );
    const { access_token } = tokenResp.data;
    if (!access_token) return res.status(401).json({ error: 'GitHub token exchange failed' });

    const [userResp, emailResp] = await Promise.all([
      axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
      }),
      axios.get('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
      }).catch(() => ({ data: [] })),
    ]);

    const gh = userResp.data;
    if (!gh.id) return res.status(401).json({ error: 'Failed to get GitHub user info' });

    let primaryEmail = gh.email;
    try {
      const primary = emailResp.data.find(e => e.primary && e.verified);
      if (primary) primaryEmail = primary.email;
    } catch (_) {}

    const db = getDB();
    const ghIdStr = String(gh.id);

    let [rows] = await db.query('SELECT * FROM users WHERE github_id = ? LIMIT 1', [ghIdStr]);
    let user = rows[0];

    if (!user && primaryEmail) {
      [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [primaryEmail]);
      user = rows[0];
      if (user) await db.query('UPDATE users SET github_id = ? WHERE grudge_id = ?', [ghIdStr, user.grudge_id]).catch(() => {});
    }

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query(
        'UPDATE users SET last_login = NOW(), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gh.avatar_url || null, user.grudge_id]
      );
    } else {
      user = await getOrCreateUser(db, 'github_id', ghIdStr, {
        ...(primaryEmail ? { email: primaryEmail } : {}),
      });
      await db.query(
        'UPDATE users SET display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE grudge_id = ?',
        [gh.name || gh.login || null, gh.avatar_url || null, user.grudge_id]
      ).catch(() => {});
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    const sep = appRedirect.includes('?') ? '&' : '?';
    res.redirect(`${appRedirect}${sep}token=${token}&grudge_id=${user.grudge_id}&provider=github`);
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── POST /auth/phone-verify ─────────────
// Verify SMS OTP via Twilio, login/register
router.post('/phone-verify', async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

    const normalized = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const verifySid  = process.env.TWILIO_VERIFY_SID;
    if (!accountSid || !authToken || !verifySid) {
      return res.status(503).json({ error: 'Phone auth not configured' });
    }

    // Verify OTP
    const twilioResp = await axios.post(
      `https://verify.twilio.com/v2/Services/${verifySid}/VerificationCheck`,
      new URLSearchParams({ To: normalized, Code: code }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: accountSid, password: authToken },
      }
    );
    if (twilioResp.data.status !== 'approved') {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const db = getDB();
    let [rows] = await db.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [normalized]);
    let user = rows[0];
    let isNewUser = false;

    if (user) {
      if (user.is_banned) return res.status(403).json({ error: user.ban_reason || 'Account banned' });
      await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    } else {
      isNewUser = true;
      const grudge_id = uuidv4();
      const puter_id = `GRUDGE-${grudge_id.split('-')[0].toUpperCase()}`;
      const username = `ph_${normalized.replace(/\+/g, '').slice(-8)}`;
      const password_hash = await bcrypt.hash(uuidv4(), 10);

      let server_wallet_address = null;
      let server_wallet_index = null;
      try {
        const resp = await axios.post(
          `${WALLET_SERVICE_URL}/wallet/create`, { grudge_id },
          { headers: { 'x-internal-key': INTERNAL_API_KEY } }
        );
        server_wallet_address = resp.data.address;
        server_wallet_index = resp.data.index;
      } catch (e) { console.warn('[grudge-id] wallet-service unavailable:', e.message); }

      await db.query(
        `INSERT INTO users
          (grudge_id, puter_id, username, display_name, phone, password_hash,
           server_wallet_address, server_wallet_index, is_guest, gold, gbux_balance, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, 1000, 0, NOW())`,
        [grudge_id, puter_id, username, 'Phone User', normalized, password_hash,
         server_wallet_address, server_wallet_index]
      );

      [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
      user = rows[0];
    }

    const token = issueToken(user);
    setSsoCookie(res, token);
    res.json(formatAuthResponse(user, token, isNewUser));
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── GET /auth/sso-check ───────────────────────
// Cross-app SSO: reads grudge_sso cookie, redirects with token if valid
router.get('/sso-check', (req, res) => {
  const returnUrl = req.query.return;
  if (!returnUrl || !isAllowedOrigin(returnUrl)) {
    return res.status(400).json({ error: 'Invalid or missing return URL' });
  }

  const ssoCookie = req.cookies?.[SSO_COOKIE_NAME];
  const sep = returnUrl.includes('?') ? '&' : '?';

  if (ssoCookie) {
    try {
      jwt.verify(ssoCookie, JWT_SECRET);
      // Valid session — redirect with token
      return res.redirect(`${returnUrl}${sep}sso_token=${ssoCookie}`);
    } catch {
      // Expired/invalid — clear cookie and redirect without token
      res.clearCookie(SSO_COOKIE_NAME, SSO_COOKIE_OPTS);
    }
  }

  // No valid session — redirect back, app shows login
  res.redirect(`${returnUrl}${sep}sso_required=true`);
});

// ── POST /auth/logout (clears SSO cookie) ─────
router.post('/logout', (req, res) => {
  res.clearCookie(SSO_COOKIE_NAME, SSO_COOKIE_OPTS);
  res.json({ success: true });
});

module.exports = router;
