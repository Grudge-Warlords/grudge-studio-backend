"use strict";

const { pool } = require("../db");
const { nanoid } = require("nanoid");

/** Generate a unique Grudge ID like GID-a8Xk29mP */
function makeGrudgeId() {
  return `GID-${nanoid(12)}`;
}

/**
 * Find a user by provider + provider UID.
 * Returns the full user row or null.
 */
async function findByProvider(provider, providerUid) {
  const [rows] = await pool.execute(
    `SELECT u.* FROM users u
     JOIN user_providers up ON up.user_id = u.id
     WHERE up.provider = ? AND up.provider_uid = ?
     LIMIT 1`,
    [provider, providerUid]
  );
  return rows[0] || null;
}

/** Find a user by email. */
async function findByEmail(email) {
  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

/** Find a user by username. */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  return rows[0] || null;
}

/** Find a user by ID. */
async function findById(id) {
  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0] || null;
}

/**
 * Create a new user + link a provider in one transaction.
 * @param {object} opts
 * @param {string} opts.displayName
 * @param {string} [opts.email]
 * @param {string} [opts.username]
 * @param {string} [opts.passwordHash]
 * @param {string} [opts.avatarUrl]
 * @param {boolean} [opts.isGuest]
 * @param {string} opts.provider
 * @param {string} opts.providerUid
 * @param {object} [opts.providerData]
 * @returns {object} The created user row.
 */
async function createWithProvider(opts) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const grudgeId = makeGrudgeId();
    const username = opts.username || null;
    const [userResult] = await conn.execute(
      `INSERT INTO users (grudge_id, username, display_name, email, password_hash, avatar_url, is_guest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        grudgeId,
        username,
        opts.displayName || "Player",
        opts.email || null,
        opts.passwordHash || null,
        opts.avatarUrl || null,
        opts.isGuest ? 1 : 0,
      ]
    );

    const userId = userResult.insertId;

    await conn.execute(
      `INSERT INTO user_providers (user_id, provider, provider_uid, provider_data)
       VALUES (?, ?, ?, ?)`,
      [
        userId,
        opts.provider,
        opts.providerUid,
        opts.providerData ? JSON.stringify(opts.providerData) : null,
      ]
    );

    await conn.commit();

    return {
      id: userId,
      grudge_id: grudgeId,
      username: username,
      display_name: opts.displayName || "Player",
      email: opts.email || null,
      avatar_url: opts.avatarUrl || null,
      is_guest: opts.isGuest ? 1 : 0,
      faction: null,
      is_premium: 0,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Find user by provider or create a new one.
 * Returns { user, created }.
 */
async function findOrCreateByProvider(opts) {
  const existing = await findByProvider(opts.provider, opts.providerUid);
  if (existing) {
    return { user: existing, created: false };
  }

  // If email is provided, check if a user with that email already exists
  // and link the provider to that existing account
  if (opts.email) {
    const byEmail = await findByEmail(opts.email);
    if (byEmail) {
      await linkProvider(byEmail.id, opts.provider, opts.providerUid, opts.providerData);
      return { user: byEmail, created: false };
    }
  }

  const user = await createWithProvider(opts);
  return { user, created: true };
}

/**
 * Link an additional auth provider to an existing user.
 */
async function linkProvider(userId, provider, providerUid, providerData) {
  await pool.execute(
    `INSERT INTO user_providers (user_id, provider, provider_uid, provider_data)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE provider_data = VALUES(provider_data), linked_at = NOW()`,
    [userId, provider, providerUid, providerData ? JSON.stringify(providerData) : null]
  );
}

/**
 * Get all providers linked to a user.
 */
async function getProviders(userId) {
  const [rows] = await pool.execute(
    "SELECT provider, provider_uid, linked_at FROM user_providers WHERE user_id = ?",
    [userId]
  );
  return rows;
}

/**
 * Upgrade a guest account by setting email/password and removing guest flag.
 */
async function claimGuest(userId, email, passwordHash, displayName) {
  await pool.execute(
    `UPDATE users SET email = ?, password_hash = ?, display_name = ?, is_guest = 0
     WHERE id = ? AND is_guest = 1`,
    [email, passwordHash, displayName, userId]
  );
}

/**
 * Format a user row into the UserProfile shape expected by grudge-platform.
 */
function toUserProfile(user, providers) {
  return {
    id: String(user.id),
    grudgeId: user.grudge_id,
    username: user.username || user.display_name,
    displayName: user.display_name,
    email: user.email || null,
    avatarUrl: user.avatar_url || null,
    isGuest: Boolean(user.is_guest),
    isPremium: Boolean(user.is_premium),
    faction: user.faction || null,
    walletAddress: null, // filled by caller if wallet provider exists
    hasHomeIsland: false, // filled by game-api
    providers: providers ? providers.map((p) => p.provider) : [],
  };
}

/* ============================================================
 * Link-providers flow helpers
 * Added 2026-04 for the /auth/links/* (plural) endpoints.
 * Existing helpers above are untouched — these compose them.
 * ============================================================ */

/** Look up a single (provider, provider_uid) link row. Null if absent. */
async function findProviderLink(provider, providerUid) {
  const [rows] = await pool.execute(
    `SELECT * FROM user_providers
      WHERE provider = ? AND provider_uid = ?
      LIMIT 1`,
    [provider, providerUid]
  );
  return rows[0] || null;
}

/**
 * Detailed list of providers for a user — includes linked_at,
 * provider_email and last_login_at (added by migration 02).
 * Used by GET /auth/links to drive the Profile UI.
 */
async function getProvidersDetailed(userId) {
  const [rows] = await pool.execute(
    `SELECT provider, provider_uid, provider_email, linked_at, last_login_at, provider_data
       FROM user_providers WHERE user_id = ?
       ORDER BY linked_at ASC`,
    [userId]
  );
  return rows;
}

/**
 * Attach a provider account to a SPECIFIC user (link-intent flow).
 * Decision tree:
 *   - If (provider, providerUid) already maps to `userId`  → no-op success.
 *   - If (provider, providerUid) maps to a DIFFERENT user → return
 *     { wasLinked: false, conflictUserId } so the caller can prompt
 *     the user to merge instead of silently re-attaching.
 *   - Otherwise INSERT a new user_providers row → { wasLinked: true }.
 *
 * The unique key (provider, provider_uid) on user_providers is the
 * database-level guarantee against ever creating duplicate links.
 *
 * @param {object}  opts
 * @param {number}  opts.userId         Grudge user.id to attach to.
 * @param {string}  opts.provider       Provider key (discord/google/...).
 * @param {string}  opts.providerUid    Stable provider ID.
 * @param {string}  [opts.providerEmail] Email reported by the provider.
 * @param {object}  [opts.providerData] Extra provider blob.
 */
async function attachProviderToUser(opts) {
  const { userId, provider, providerUid, providerEmail, providerData } = opts;
  if (!userId || !provider || !providerUid) {
    throw new Error("attachProviderToUser: missing required fields");
  }

  const existing = await findProviderLink(provider, providerUid);
  if (existing) {
    if (existing.user_id === userId) {
      // Already linked to this user — refresh metadata only.
      await pool.execute(
        `UPDATE user_providers
            SET provider_email = COALESCE(?, provider_email),
                provider_data  = COALESCE(?, provider_data),
                last_login_at  = NOW()
          WHERE id = ?`,
        [
          providerEmail || null,
          providerData ? JSON.stringify(providerData) : null,
          existing.id,
        ]
      );
      return { wasLinked: false, alreadyLinked: true };
    }
    // Conflict — provider account belongs to a different Grudge ID.
    return { wasLinked: false, conflictUserId: existing.user_id };
  }

  await pool.execute(
    `INSERT INTO user_providers (user_id, provider, provider_uid, provider_email, provider_data, last_login_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      userId,
      provider,
      providerUid,
      providerEmail || null,
      providerData ? JSON.stringify(providerData) : null,
    ]
  );
  return { wasLinked: true };
}

/**
 * Unlink a provider from a user. Refuses if it would leave the
 * user with zero auth providers (i.e. unable to sign back in).
 *
 * Returns { unlinked: true } on success or
 *         { unlinked: false, reason: 'last-provider' | 'not-found' }.
 */
async function unlinkProvider(userId, provider, providerUid) {
  const all = await getProviders(userId);
  if (all.length <= 1) {
    return { unlinked: false, reason: "last-provider" };
  }
  const target = all.find(
    (p) => p.provider === provider && p.provider_uid === providerUid
  );
  if (!target) {
    return { unlinked: false, reason: "not-found" };
  }
  await pool.execute(
    `DELETE FROM user_providers
      WHERE user_id = ? AND provider = ? AND provider_uid = ?`,
    [userId, provider, providerUid]
  );
  return { unlinked: true };
}

/**
 * Merge `sourceUserId` into `targetUserId`.
 *
 * Scope (intentionally conservative for the first cut — only touches
 * tables in the auth DB):
 *   1. Move every user_providers row from source → target, skipping
 *      any row whose (provider, provider_uid) already maps to target
 *      (the unique key would reject it; we drop it instead).
 *   2. Delete the source user's sessions (refresh tokens).
 *   3. DELETE source user row.
 *
 * Cross-DB game data (characters / inventory / wallets) lives in
 * other services and must be migrated by them — they can listen
 * for the user.merged event we emit here in a future iteration.
 */
async function mergeUsers(targetUserId, sourceUserId) {
  if (targetUserId === sourceUserId) {
    return { merged: false, reason: "same-user" };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify both users exist.
    const [tgtRows] = await conn.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [targetUserId]);
    const [srcRows] = await conn.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [sourceUserId]);
    if (!tgtRows[0] || !srcRows[0]) {
      await conn.rollback();
      return { merged: false, reason: "user-not-found" };
    }

    // 1. Reassign provider rows that are safe (no conflict on the unique key).
    await conn.execute(
      `UPDATE IGNORE user_providers
          SET user_id = ?
        WHERE user_id = ?`,
      [targetUserId, sourceUserId]
    );
    // 2. Delete any provider rows that couldn't be reassigned (they collided
    //    with an existing target row — target wins, we drop the duplicate).
    const [leftover] = await conn.execute(
      `DELETE FROM user_providers WHERE user_id = ?`,
      [sourceUserId]
    );

    // 3. Drop refresh sessions belonging to the source.
    await conn.execute("DELETE FROM sessions WHERE user_id = ?", [sourceUserId]);

    // 4. Delete the source user. ON DELETE CASCADE on FK fk_up_user catches
    //    any leftover provider rows we might have missed.
    await conn.execute("DELETE FROM users WHERE id = ?", [sourceUserId]);

    await conn.commit();
    return {
      merged: true,
      providersReassigned: true,
      duplicateProvidersDropped: leftover.affectedRows || 0,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  makeGrudgeId,
  findByProvider,
  findByEmail,
  findByUsername,
  findById,
  createWithProvider,
  findOrCreateByProvider,
  linkProvider,
  getProviders,
  claimGuest,
  toUserProfile,
  // Link-providers flow:
  findProviderLink,
  getProvidersDetailed,
  attachProviderToUser,
  unlinkProvider,
  mergeUsers,
};
