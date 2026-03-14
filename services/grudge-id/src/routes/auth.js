const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { getDB } = require('../db');
const { verifyTurnstile } = require('../middleware/turnstile');

const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN || '7d';
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL;
const INTERNAL_API_KEY   = process.env.INTERNAL_API_KEY;

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

    res.json({ token, grudge_id: user.grudge_id, puter_id: user.puter_id });
  } catch (err) {
    if (err.banned) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// ── GET /auth/discord ─────────────────────────
// Redirect to Discord OAuth
router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ── GET /auth/discord/callback ────────────────
router.get('/discord/callback', async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });

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

    // Redirect to frontend with token
    res.redirect(`https://grudgewarlords.com/auth?token=${token}&grudge_id=${user.grudge_id}`);
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
        gold: user.gold || 1000,
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

// ── POST /auth/register ───────────────────────
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

    res.status(201).json({
      success: true,
      token,
      grudgeId: user.grudge_id,
      username: user.username,
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

module.exports = router;
