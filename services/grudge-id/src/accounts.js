/**
 * accounts.js — Canonical account creation & resolution
 * =====================================================================
 * THE single source of truth for turning any login signal into exactly
 * one Grudge ID. Every auth/identity route MUST create accounts through
 * this module so the "one human = one canonical Grudge ID" invariant
 * holds no matter which provider the player arrives through.
 *
 * Invariants enforced here:
 *   1. grudge_id is ALWAYS a UUID v4 (matches `users.grudge_id VARCHAR(36)`).
 *      Never the legacy `grudge_<puter>` scheme.
 *   2. puter_id holds a REAL Puter account UUID or NULL — never a
 *      fabricated `GRUDGE-xxxx` placeholder. NULL is allowed by the
 *      UNIQUE index (MySQL permits multiple NULLs), so unauthenticated
 *      / non-Puter signups simply leave it NULL until the client runs
 *      Puter onboarding and links it to THIS account.
 *   3. Every new account is provisioned a server-side custodial wallet
 *      (best-effort — never blocks signup if wallet-service is down).
 *
 * See docs/ACCOUNT_LINKING.md for the full model.
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL;
const INTERNAL_API_KEY   = process.env.INTERNAL_API_KEY;

// Canonical column for the real Puter account UUID. `puter_uuid` is a
// deprecated duplicate (see migration 025) — do not write to it.
const PUTER_COLUMN = 'puter_id';

// Columns that uniquely identify a human. resolveOrCreateUser() and the
// linking layer only ever match/attach on these. Used as an allow-list so
// a column name can never be injected into SQL.
const CREDENTIAL_COLUMNS = [
  'discord_id', 'google_id', 'github_id',
  'wallet_address', 'web3auth_id',
  'phone', 'email', 'puter_id', 'username',
];

// Columns createUser() is permitted to set. Anything else in `fields` is
// ignored. This is the SQL-injection guard for the dynamic INSERT.
const INSERTABLE_COLUMNS = new Set([
  'grudge_id', 'username', 'email', 'password_hash', 'display_name',
  'discord_id', 'discord_tag', 'wallet_address', 'web3auth_id',
  'google_id', 'github_id', 'github_username', 'phone', 'avatar_url',
  'puter_id', 'puter_username', 'faction', 'race', 'class',
  'gold', 'gbux_balance', 'is_guest', 'is_temp',
  'server_wallet_address', 'server_wallet_index',
]);

function generateGrudgeId() {
  return uuidv4();
}

/** True for the legacy fabricated placeholder (e.g. "GRUDGE-AB12CD34"). */
function isFabricatedPuterId(value) {
  return !value || /^GRUDGE-/i.test(String(value));
}

/**
 * Best-effort server-side custodial wallet provisioning.
 * Never throws — a wallet outage must not block account creation.
 */
async function provisionServerWallet(grudge_id) {
  if (!WALLET_SERVICE_URL) return { address: null, index: null };
  try {
    const resp = await axios.post(
      `${WALLET_SERVICE_URL}/wallet/create`,
      { grudge_id },
      { headers: { 'x-internal-key': INTERNAL_API_KEY }, timeout: 5000 }
    );
    return { address: resp.data.address ?? null, index: resp.data.index ?? null };
  } catch (e) {
    console.warn('[grudge-id:accounts] wallet-service unavailable:', e.message);
    return { address: null, index: null };
  }
}

/**
 * THE canonical account-creation path. Builds one parameterised INSERT
 * from a whitelisted `fields` object, provisions a server wallet, and
 * returns the freshly-created user row (with `_isNew = true`).
 *
 * `db` may be a pool or a transaction connection (anything with .query()).
 */
async function createUser(db, fields = {}) {
  const grudge_id = fields.grudge_id || generateGrudgeId();
  const wallet = await provisionServerWallet(grudge_id);

  const row = {
    gold: 1000,
    gbux_balance: 0,
    is_guest: 0,
    ...fields,
    grudge_id,
    server_wallet_address: wallet.address,
    server_wallet_index: wallet.index,
  };

  // Invariant #2 — never persist a fabricated puter_id.
  if (isFabricatedPuterId(row.puter_id)) row.puter_id = null;

  const cols = Object.keys(row).filter((k) => INSERTABLE_COLUMNS.has(k));
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((k) => row[k]);

  await db.query(
    `INSERT INTO users (${cols.join(', ')}, last_login) VALUES (${placeholders}, NOW())`,
    values
  );

  const [rows] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [grudge_id]);
  const user = rows[0];
  if (user) user._isNew = true;
  return user;
}

/**
 * Resolve a login signal to exactly one account, or create one.
 *
 *   1. If a user already owns this credential → return it (login).
 *      (Bumps last_login; throws 403 if banned.)
 *   2. Else if `sessionGrudgeId` is supplied (the caller is already
 *      authenticated) and that account doesn't yet have this credential
 *      → ATTACH the credential to the session account. This is what
 *      prevents a 2nd account when an existing player adds a new
 *      provider (e.g. a Discord user later onboards Puter).
 *   3. Else → create a brand-new canonical account carrying it.
 *
 * @param {object}  db
 * @param {object}  opts
 * @param {string}  opts.field    one of CREDENTIAL_COLUMNS
 * @param {string}  opts.value    the credential value
 * @param {?string} opts.sessionGrudgeId  authenticated caller's grudge_id
 * @param {object}  opts.extra    extra columns to set on create/attach
 */
async function resolveOrCreateUser(db, { field, value, sessionGrudgeId = null, extra = {} }) {
  if (!CREDENTIAL_COLUMNS.includes(field)) {
    throw new Error(`resolveOrCreateUser: illegal credential field "${field}"`);
  }
  if (value == null || value === '') {
    throw new Error('resolveOrCreateUser: value is required');
  }

  // 1. Existing account owns this credential.
  const [found] = await db.query(`SELECT * FROM users WHERE \`${field}\` = ? LIMIT 1`, [value]);
  if (found.length) {
    const user = found[0];
    if (user.is_banned) {
      const err = new Error(user.ban_reason || 'Account banned');
      err.status = 403;
      err.banned = true;
      throw err;
    }
    await db.query('UPDATE users SET last_login = NOW() WHERE grudge_id = ?', [user.grudge_id]);
    return user;
  }

  // 2. Attach to the caller's existing session account if it's free.
  if (sessionGrudgeId) {
    const [sess] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [sessionGrudgeId]);
    if (sess.length && !sess[0][field]) {
      await db.query(
        `UPDATE users SET \`${field}\` = ?, last_login = NOW() WHERE grudge_id = ?`,
        [value, sessionGrudgeId]
      );
      const [updated] = await db.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [sessionGrudgeId]);
      return updated[0];
    }
  }

  // 3. Create a new canonical account.
  return createUser(db, { [field]: value, ...extra });
}

module.exports = {
  PUTER_COLUMN,
  CREDENTIAL_COLUMNS,
  generateGrudgeId,
  isFabricatedPuterId,
  provisionServerWallet,
  createUser,
  resolveOrCreateUser,
};
