const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const { getDB } = require('../db');

const CODE_TTL_MINUTES = 10;

// ── Auth helper ───────────────────────────────────────────────────────────────
function getUser(req) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.JWT_SECRET); }
  catch { return null; }
}

function requireUser(req, res) {
  const u = getUser(req);
  if (!u) { res.status(401).json({ error: 'Sign in required' }); return null; }
  return u;
}

// Generate a random 6-char alphanumeric code (uppercase, no O/0/I/1 for readability)
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6))
    .map(b => chars[b % chars.length])
    .join('');
}

// ── POST /device/code ─────────────────────────────────────────────────────────
// Called by a GRUDA Node to request a pairing code.
// No auth required — the device isn't paired yet.
router.post('/code', async (req, res, next) => {
  try {
    const { deviceId, deviceName, deviceType } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const db      = getDB();
    const code    = genCode();
    const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    const ip      = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

    // Expire any old pending codes for this device
    await db.query(
      `UPDATE grudge_devices SET status = 'expired'
       WHERE device_id = ? AND status = 'pending'`,
      [deviceId]
    );

    await db.query(
      `INSERT INTO grudge_devices
         (code, device_id, device_name, device_type, status, ip, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [code, deviceId, deviceName || 'GRUDA Node', deviceType || 'node', ip, expires]
    );

    res.json({
      code,
      expiresAt:  expires.toISOString(),
      expiresInSeconds: CODE_TTL_MINUTES * 60,
      message: `Visit id.grudge-studio.com/device and enter code: ${code}`,
    });
  } catch (err) { next(err); }
});

// ── GET /device/status/:code ──────────────────────────────────────────────────
// GRUDA Node polls this to know when it has been approved.
// Returns { status, grudgeId, username } when approved.
router.get('/status/:code', async (req, res, next) => {
  try {
    const code = req.params.code?.toUpperCase();
    const db   = getDB();

    // Auto-expire stale codes
    await db.query(
      `UPDATE grudge_devices SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`
    );

    const [[row]] = await db.query(
      `SELECT d.*, u.username, u.puter_id, u.server_wallet_address
       FROM grudge_devices d
       LEFT JOIN users u ON u.grudge_id = d.grudge_id
       WHERE d.code = ? LIMIT 1`,
      [code]
    );

    if (!row) return res.status(404).json({ status: 'not_found' });

    // Update last_seen for the device
    if (row.status === 'approved') {
      await db.query(
        'UPDATE grudge_devices SET last_seen = NOW() WHERE code = ?', [code]
      );
    }

    res.json({
      status:   row.status,
      grudgeId: row.grudge_id   || null,
      username: row.username    || null,
      walletAddress: row.server_wallet_address || null,
      deviceId: row.id,
      pairedAt: row.paired_at   || null,
    });
  } catch (err) { next(err); }
});

// ── POST /device/approve ──────────────────────────────────────────────────────
// User (logged in) enters code on device.html → pairs device to their account.
router.post('/approve', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { code } = req.body;
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid code — must be 6 characters' });
    }

    const db      = getDB();
    const cleanCode = code.toUpperCase().trim();

    // Expire stale codes first
    await db.query(
      `UPDATE grudge_devices SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`
    );

    const [[device]] = await db.query(
      `SELECT * FROM grudge_devices WHERE code = ? AND status = 'pending' LIMIT 1`,
      [cleanCode]
    );

    if (!device) {
      return res.status(404).json({
        error: 'Code not found or expired. Ask the device to generate a new code.',
      });
    }

    // Pair: bind device to this user's Grudge ID
    await db.query(
      `UPDATE grudge_devices
       SET grudge_id = ?, status = 'approved', paired_at = NOW(), last_seen = NOW()
       WHERE code = ?`,
      [user.grudge_id, cleanCode]
    );

    // Fetch updated device row
    const [[updated]] = await db.query(
      'SELECT * FROM grudge_devices WHERE code = ? LIMIT 1', [cleanCode]
    );

    // Fetch user info for response
    const [[userRow]] = await db.query(
      'SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [user.grudge_id]
    );

    res.json({
      success: true,
      message: `Device "${device.device_name}" paired to your Grudge account.`,
      device: {
        id:         updated.id,
        name:       updated.device_name,
        type:       updated.device_type,
        pairedAt:   updated.paired_at,
      },
      account: {
        grudgeId:      userRow.grudge_id,
        username:      userRow.username,
        walletAddress: userRow.server_wallet_address,
        gold:          userRow.gold,
        gbuxBalance:   userRow.gbux_balance,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /device/list ──────────────────────────────────────────────────────────
// Returns all devices paired to the logged-in user.
router.get('/list', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const db = getDB();
    const [devices] = await db.query(
      `SELECT id, device_name, device_type, status, paired_at, last_seen, ip
       FROM grudge_devices
       WHERE grudge_id = ? AND status = 'approved'
       ORDER BY paired_at DESC`,
      [user.grudge_id]
    );

    res.json({ devices });
  } catch (err) { next(err); }
});

// ── DELETE /device/:deviceId ──────────────────────────────────────────────────
// Unpair / revoke a device.
router.delete('/:deviceId', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const db = getDB();
    const [result] = await db.query(
      `UPDATE grudge_devices SET status = 'revoked'
       WHERE id = ? AND grudge_id = ?`,
      [req.params.deviceId, user.grudge_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({ success: true, message: 'Device unpaired.' });
  } catch (err) { next(err); }
});

module.exports = router;
