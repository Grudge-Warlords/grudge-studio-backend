const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

// ── Auth middleware ───────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── GET /identity/me ──────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT grudge_id, username, puter_id, discord_id, discord_tag,
              wallet_address, server_wallet_address, faction, race, class,
              is_active, created_at, last_login
       FROM users WHERE grudge_id = ? LIMIT 1`,
      [req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /identity/me ────────────────────────
// Update username, faction, race, class
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['username', 'faction', 'race', 'class'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const db = getDB();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE users SET ${setClauses} WHERE grudge_id = ?`,
      [...Object.values(updates), req.user.grudge_id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /identity/link-puter ────────────────────────────────────────────────
// Called by puter-onboarding.ts autoOnboard().
// Creates a Grudge ID for a new Puter UUID, or returns the existing one.
// This is the entry point that converts every visitor into a tracked player
// whose Puter usage generates PIP revenue for GRUDGE STUDIO.
//
// Body: { puterUuid, isTemp, username? }
// Returns: GrudgeIdentity
router.post('/link-puter', async (req, res, next) => {
  try {
    const { puterUuid, isTemp, username } = req.body;
    if (!puterUuid) return res.status(400).json({ error: 'puterUuid is required' });

    const db = getDB();
    const now = new Date();

    // 1. Does this Puter UUID already exist?
    const [existing] = await db.query(
      `SELECT grudge_id, username, puter_id, discord_id, discord_tag,
              wallet_address, web3auth_id, is_temp, is_active, created_at, last_login
       FROM users WHERE puter_id = ? LIMIT 1`,
      [puterUuid]
    );

    if (existing.length) {
      const u = existing[0];
      // Update is_temp status if they've claimed their account
      if (u.is_temp && !isTemp) {
        await db.query(
          'UPDATE users SET is_temp = 0, last_login = ? WHERE puter_id = ?',
          [now, puterUuid]
        );
      } else {
        await db.query('UPDATE users SET last_login = ? WHERE puter_id = ?', [now, puterUuid]);
      }

      return res.json({
        grudgeId:    u.grudge_id,
        puterUuid,
        username:    u.username,
        isTemp:      isTemp ? (u.is_temp === 1) : false,
        isNew:       false,
        linkedAuth: {
          discord:       u.discord_id   || undefined,
          walletAddress: u.wallet_address || undefined,
          web3authId:    u.web3auth_id  || undefined,
        },
        pipActive:   true,
        createdAt:   u.created_at,
        lastSeen:    now.toISOString(),
      });
    }

    // 2. New Puter UUID → generate Grudge ID and create user
    const grudgeId = 'grudge_' + puterUuid.replace(/-/g, '').slice(0, 12);
    const safeUsername = username || `player_${grudgeId.slice(-6)}`;

    await db.query(
      `INSERT INTO users
         (grudge_id, username, puter_id, is_temp, is_active, created_at, last_login)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [grudgeId, safeUsername, puterUuid, isTemp ? 1 : 0, now, now]
    );

    console.log(`[grudge-id] New player onboarded: ${grudgeId} (puter: ${puterUuid}, temp: ${isTemp})`);

    return res.status(201).json({
      grudgeId,
      puterUuid,
      username: safeUsername,
      isTemp:   !!isTemp,
      isNew:    true,
      linkedAuth: {},
      pipActive: true,
      createdAt: now.toISOString(),
      lastSeen:  now.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /identity/link-auth ──────────────────────────────────────────────────
// Links a Discord ID, wallet address, or web3auth ID to an existing Grudge ID.
// Called by puter-onboarding.ts linkAuth() after Discord/wallet/Web3Auth login.
// One player → one Grudge ID → multiple auth methods all linked.
//
// Body: { grudgeId, puterUuid, authMethod: 'discord'|'wallet'|'web3auth'|'email', credential }
router.post('/link-auth', async (req, res, next) => {
  try {
    const { grudgeId, puterUuid, authMethod, credential } = req.body;
    if (!grudgeId || !authMethod || !credential) {
      return res.status(400).json({ error: 'grudgeId, authMethod, and credential are required' });
    }

    const db = getDB();
    const columnMap = {
      discord:   'discord_id',
      wallet:    'wallet_address',
      web3auth:  'web3auth_id',
      email:     'email',
    };

    const column = columnMap[authMethod];
    if (!column) return res.status(400).json({ error: `Unknown authMethod: ${authMethod}` });

    // Check if this credential is already linked to a DIFFERENT Grudge ID
    const [conflict] = await db.query(
      `SELECT grudge_id FROM users WHERE ${column} = ? AND grudge_id != ? LIMIT 1`,
      [credential, grudgeId]
    );

    if (conflict.length) {
      // Merge: update the conflicting record to point to this grudge_id
      // (prefer the newer/puter-linked identity)
      await db.query(
        `UPDATE users SET ${column} = NULL WHERE grudge_id = ?`,
        [conflict[0].grudge_id]
      );
    }

    await db.query(
      `UPDATE users SET ${column} = ? WHERE grudge_id = ?`,
      [credential, grudgeId]
    );

    const [updated] = await db.query(
      `SELECT grudge_id, discord_id, wallet_address, web3auth_id, email
       FROM users WHERE grudge_id = ? LIMIT 1`,
      [grudgeId]
    );

    const u = updated[0] || {};
    return res.json({
      grudgeId,
      puterUuid,
      linkedAuth: {
        discord:       u.discord_id      || undefined,
        walletAddress: u.wallet_address  || undefined,
        web3authId:    u.web3auth_id     || undefined,
        email:         u.email           || undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /identity/claim-account ──────────────────────────────────────────────
// Called when a temp Puter user upgrades to a permanent account.
// Updates is_temp flag in our DB.
// Body: { puterUuid }
router.post('/claim-account', async (req, res, next) => {
  try {
    const { puterUuid } = req.body;
    if (!puterUuid) return res.status(400).json({ error: 'puterUuid is required' });

    const db = getDB();
    const [result] = await db.query(
      'UPDATE users SET is_temp = 0, last_login = NOW() WHERE puter_id = ?',
      [puterUuid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No user found with this puter_id' });
    }

    const [rows] = await db.query(
      'SELECT grudge_id FROM users WHERE puter_id = ? LIMIT 1',
      [puterUuid]
    );

    console.log(`[grudge-id] Account claimed: ${rows[0]?.grudge_id} (puter: ${puterUuid})`);
    return res.json({ success: true, grudgeId: rows[0]?.grudge_id });
  } catch (err) {
    next(err);
  }
});

// ── GET /identity/:grudge_id ──────────────────
// Public profile lookup
router.get('/:grudge_id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT grudge_id, username, puter_id, faction, race, class, created_at
       FROM users WHERE grudge_id = ? AND is_active = 1 LIMIT 1`,
      [req.params.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
