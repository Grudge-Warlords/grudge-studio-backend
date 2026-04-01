// device.js — GRUDA Node pairing API
// POST /device/auth/request   — ESP32 registers its 6-char pairing code
// GET  /device/auth/poll      — ESP32 polls for approval status
// POST /device/auth/approve   — authenticated user approves the pairing
// POST /device/auth/expire    — device cancels / session logs out

const express = require('express');
const jwt     = require('jsonwebtoken');
const { getDB } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const CODE_TTL_MS = 5 * 60 * 1000; // codes expire after 5 minutes

// ── auth middleware (optional — allows unauthenticated access with null user)
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
    } catch { req.user = null; }
  }
  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Auth required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── cleanup expired codes (called opportunistically)
async function sweepExpired(db) {
  try {
    await db.execute(
      "UPDATE device_pairings SET status='expired' WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
    );
  } catch {}
}

// POST /device/auth/request
// Body: { code, deviceId, walletPubkey, deviceInfo? }
// Called by ESP32 on boot to register its pairing code.
router.post('/auth/request', async (req, res) => {
  const { code, deviceId, walletPubkey, deviceInfo } = req.body || {};
  if (!code || code.length !== 6) {
    return res.status(400).json({ error: 'code must be exactly 6 characters' });
  }
  const db = getDB();
  await sweepExpired(db);
  try {
    // Upsert: if this device already has a pending code, replace it
    await db.execute(
      `INSERT INTO device_pairings (code, device_id, wallet_pubkey, device_info, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         device_id    = VALUES(device_id),
         wallet_pubkey= VALUES(wallet_pubkey),
         device_info  = VALUES(device_info),
         status       = 'pending',
         user_id      = NULL,
         token        = NULL,
         updated_at   = NOW()`,
      [code.toUpperCase(), deviceId || null, walletPubkey || null,
       deviceInfo ? JSON.stringify(deviceInfo) : null]
    );
    return res.json({ success: true, code: code.toUpperCase(), expiresIn: 300 });
  } catch (err) {
    console.error('[device/request]', err.message);
    return res.status(500).json({ error: 'Could not register device code' });
  }
});

// GET /device/auth/poll?code=XXXXXX
// Called by ESP32 every 3-5 seconds to check approval status.
router.get('/auth/poll', async (req, res) => {
  const code = (req.query.code || '').toUpperCase();
  if (!code || code.length !== 6) {
    return res.status(400).json({ error: 'code required' });
  }
  const db = getDB();
  await sweepExpired(db);
  try {
    const [rows] = await db.execute(
      'SELECT status, token, grudge_id, user_id FROM device_pairings WHERE code = ? LIMIT 1',
      [code]
    );
    if (!rows.length) return res.status(404).json({ status: 'not_found' });
    const row = rows[0];
    if (row.status === 'approved') {
      return res.json({ status: 'approved', token: row.token, grudgeId: row.grudge_id });
    }
    return res.json({ status: row.status });
  } catch (err) {
    console.error('[device/poll]', err.message);
    return res.status(500).json({ error: 'Poll failed' });
  }
});

// POST /device/auth/approve
// Body: { code }
// Called by browser after user enters the code on id.grudge-studio.com/device
router.post('/auth/approve', requireAuth, async (req, res) => {
  const code = ((req.body || {}).code || '').toUpperCase();
  if (!code || code.length !== 6) {
    return res.status(400).json({ error: 'code required' });
  }
  const db = getDB();
  await sweepExpired(db);
  try {
    const [rows] = await db.execute(
      "SELECT id, status FROM device_pairings WHERE code = ? AND status = 'pending' LIMIT 1",
      [code]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Code not found or already expired' });
    }
    // Issue a long-lived device JWT for the approved session
    const deviceToken = jwt.sign(
      { userId: req.user.userId, grudgeId: req.user.grudgeId, deviceCode: code, type: 'device' },
      JWT_SECRET,
      { expiresIn: '365d' }
    );
    await db.execute(
      "UPDATE device_pairings SET status='approved', user_id=?, grudge_id=?, token=?, updated_at=NOW() WHERE code=?",
      [req.user.userId, req.user.grudgeId, deviceToken, code]
    );
    return res.json({ success: true, message: 'Device approved — it will connect shortly.' });
  } catch (err) {
    console.error('[device/approve]', err.message);
    return res.status(500).json({ error: 'Approval failed' });
  }
});

// POST /device/auth/expire  — device logout / session wipe
router.post('/auth/expire', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  const db = getDB();
  try {
    await db.execute(
      "UPDATE device_pairings SET status='expired' WHERE code = ?",
      [code.toUpperCase()]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Expire failed' });
  }
});

module.exports = router;
