const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── POST /launch-token ────────────────────────────────────────────
// Auth required — issues a one-time 5-minute JWT for the game client.
// The game client sends this to grudge-headless on connect.
// grudge-headless validates it via GET /validate-launch-token (internal).
// Body: { computer_id? }
router.post('/launch-token', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  const { computer_id = null } = req.body;

  const db = getDB();
  try {
    // Verify user is not banned
    const [[user]] = await db.query(
      'SELECT grudge_id, is_banned, username, faction, race, class FROM users WHERE grudge_id = ?',
      [me]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });

    // Verify computer is registered and not revoked (if provided)
    if (computer_id) {
      const [[comp]] = await db.query(
        'SELECT id FROM computer_registrations WHERE computer_id = ? AND grudge_id = ? AND is_revoked = FALSE',
        [computer_id, me]
      );
      if (!comp) return res.status(403).json({ error: 'Computer not registered or revoked' });
    }

    // Expire old unused tokens for this user (clean up)
    await db.query(
      'UPDATE launch_tokens SET used = TRUE WHERE grudge_id = ? AND used = FALSE AND expires_at < NOW()',
      [me]
    );

    // Issue new one-time launch token (5 min TTL)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const secret = process.env.LAUNCH_TOKEN_SECRET || process.env.JWT_SECRET;
    const payload = {
      grudge_id: me,
      username: user.username,
      faction: user.faction,
      race: user.race,
      class: user.class,
      type: 'launch',
      jti: crypto.randomUUID(),
    };
    const token = jwt.sign(payload, secret, { expiresIn: '5m' });

    await db.query(
      `INSERT INTO launch_tokens (grudge_id, token, computer_id, expires_at)
       VALUES (?, ?, ?, ?)`,
      [me, token, computer_id, expiresAt]
    );

    res.json({ token, expires_at: expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// ── GET /validate-launch-token — internal only ────────────────────
// Called by grudge-headless to validate a launch token on player connect.
// Query: ?token=<jwt>
// Marks the token as used so it can't be reused.
router.get('/validate-launch-token', async (req, res, next) => {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const db = getDB();
  try {
    const secret = process.env.LAUNCH_TOKEN_SECRET || process.env.JWT_SECRET;
    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ valid: false, error: 'Token invalid or expired' });
    }

    if (payload.type !== 'launch') {
      return res.status(401).json({ valid: false, error: 'Not a launch token' });
    }

    // Check DB record
    const [[record]] = await db.query(
      'SELECT id, used, expires_at FROM launch_tokens WHERE token = ?',
      [token]
    );
    if (!record) return res.status(401).json({ valid: false, error: 'Token not found' });
    if (record.used) return res.status(401).json({ valid: false, error: 'Token already used' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ valid: false, error: 'Token expired' });
    }

    // Mark used
    await db.query('UPDATE launch_tokens SET used = TRUE WHERE id = ?', [record.id]);

    res.json({ valid: true, grudge_id: payload.grudge_id, username: payload.username,
               faction: payload.faction, race: payload.race, class: payload.class });
  } catch (err) {
    next(err);
  }
});

// ── GET /entitlement — auth required ─────────────────────────────
// Returns whether the current user has game access.
// Currently always returns 'active' for any valid Grudge ID.
// Extend this to check purchase/NFT ownership or subscription tier.
router.get('/entitlement', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  const db = getDB();
  try {
    const [[user]] = await db.query(
      'SELECT grudge_id, is_active, is_banned FROM users WHERE grudge_id = ?',
      [me]
    );
    if (!user || !user.is_active) {
      return res.json({ has_access: false, tier: null, reason: 'inactive' });
    }
    if (user.is_banned) {
      return res.json({ has_access: false, tier: null, reason: 'banned' });
    }
    res.json({ has_access: true, tier: 'player', grudge_id: me });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
