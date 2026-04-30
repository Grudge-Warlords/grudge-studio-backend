/**
 * /auth/links/*  (plural) — Link-providers flow
 * ============================================================
 * Lets a logged-in user attach ADDITIONAL auth providers to
 * their existing Grudge ID without accidentally creating a
 * second account, and merge two existing Grudge IDs together.
 *
 * The canonical schema stores each provider ID as its own column
 * on `users` with a UNIQUE index — so the database already
 * guarantees that one provider account maps to at most one
 * Grudge ID. This module just exposes that as a clean REST API
 * with conflict-detection, last-provider safeguard, and merge.
 *
 * NOTE: this file ONLY adds endpoints — no existing route in
 * routes/auth.js, routes/identity.js, etc. is modified.
 */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

/* ── Provider catalogue ────────────────────────────────────────
 * For every supported provider:
 *   column          — the user_table column we set/null
 *   isOAuth         — true ⇢ has /start + /callback flow below
 *   isConfigured    — env-driven runtime check
 *   authorizeUrl    — builds the provider's OAuth authorize URL
 *   exchangeCode    — exchanges `code` for the provider's stable ID + email
 *   extraColumns    — additional users-table columns to update on link
 *
 * Non-OAuth providers (wallet, phone, puter, email/password) are
 * advertised so the UI can list them but POST /auth/links/start
 * refuses them with a hint pointing at the right entry endpoint.
 */
const PROVIDERS = {
  discord: {
    column: 'discord_id',
    extraColumns: ['discord_tag', 'avatar_url'],
    isOAuth: true,
    isConfigured: () => Boolean(process.env.DISCORD_CLIENT_ID),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        redirect_uri:  callbackUrl('discord'),
        response_type: 'code',
        scope:         'identify email',
        state,
        prompt:        'none',
      });
      return `https://discord.com/api/oauth2/authorize?${params}`;
    },
    exchangeCode: async (code) => {
      const tokenResp = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id:     process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type:    'authorization_code',
          code,
          redirect_uri:  callbackUrl('discord'),
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const { access_token } = tokenResp.data || {};
      if (!access_token) throw new Error('Discord token exchange failed');

      const userResp = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const u = userResp.data || {};
      if (!u.id) throw new Error('Discord profile fetch failed');

      const tag = u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : u.username;
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
        : null;

      return {
        providerId:   u.id,
        providerEmail: u.email || null,
        extras:       { discord_tag: tag, avatar_url: avatar },
      };
    },
  },

  google: {
    column: 'google_id',
    extraColumns: ['avatar_url'],
    isOAuth: true,
    isConfigured: () => Boolean(process.env.GOOGLE_CLIENT_ID),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        redirect_uri:  callbackUrl('google'),
        response_type: 'code',
        scope:         'openid email profile',
        state,
        prompt:        'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },
    exchangeCode: async (code) => {
      const tokenResp = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  callbackUrl('google'),
          grant_type:    'authorization_code',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const { access_token } = tokenResp.data || {};
      if (!access_token) throw new Error('Google token exchange failed');

      const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const u = userResp.data || {};
      if (!u.id) throw new Error('Google profile fetch failed');

      return {
        providerId:    u.id,
        providerEmail: u.email || null,
        extras:        { avatar_url: u.picture || null },
      };
    },
  },

  github: {
    column: 'github_id',
    extraColumns: ['github_username', 'avatar_url'],
    isOAuth: true,
    isConfigured: () => Boolean(process.env.GITHUB_CLIENT_ID),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id:    process.env.GITHUB_CLIENT_ID,
        redirect_uri: callbackUrl('github'),
        scope:        'read:user user:email',
        state,
        allow_signup: 'false',
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    },
    exchangeCode: async (code) => {
      const tokenResp = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri:  callbackUrl('github'),
        },
        { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }
      );
      const { access_token } = tokenResp.data || {};
      if (!access_token) throw new Error('GitHub token exchange failed');

      const [userResp, emailResp] = await Promise.all([
        axios.get('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
        }),
        axios.get('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'GrudgeStudio/1.0' },
        }).catch(() => ({ data: [] })),
      ]);
      const gh = userResp.data || {};
      if (!gh.id) throw new Error('GitHub profile fetch failed');

      let primaryEmail = gh.email;
      try {
        const primary = (emailResp.data || []).find(e => e.primary && e.verified);
        if (primary) primaryEmail = primary.email;
      } catch {}

      return {
        providerId:    String(gh.id),
        providerEmail: primaryEmail || null,
        extras: {
          github_username: gh.login || null,
          avatar_url:      gh.avatar_url || null,
        },
      };
    },
  },

  // ── Non-OAuth providers — listed but not startable from /start ──
  wallet: { column: 'wallet_address', isOAuth: false, isConfigured: () => true,
            hint: 'POST /auth/wallet  (Web3Auth flow)' },
  phone:  { column: 'phone',          isOAuth: false, isConfigured: () => true,
            hint: 'POST /auth/phone-send + /auth/phone-verify' },
  puter:  { column: 'puter_uuid',     isOAuth: false, isConfigured: () => true,
            hint: 'POST /auth/puter-link' },
  email:  { column: 'email',          isOAuth: false, isConfigured: () => true,
            hint: 'POST /auth/register or /auth/forgot-password' },
};

/** All columns we read for the /auth/links list response. */
const LINK_COLUMNS = [
  'discord_id', 'discord_tag',
  'google_id',
  'github_id', 'github_username',
  'wallet_address',
  'puter_uuid', 'puter_username',
  'phone',
  'email',
  'password_hash',
  'avatar_url',
  'last_login',
];

/** Build the link-callback URL for a given provider. */
function callbackUrl(provider) {
  const base = process.env.LINK_CALLBACK_BASE
    || process.env.GRUDGE_ID_PUBLIC_URL
    || 'https://id.grudge-studio.com';
  return `${base.replace(/\/$/, '')}/auth/links/callback/${provider}`;
}

/* ── Link-intent state JWT ───────────────────────────────────────
 * Used as `state` in the OAuth redirect. Carries the Grudge user
 * ID we want to attach the new provider to, so the callback can
 * authenticate the link request even though the OAuth provider
 * itself has no idea which Grudge user initiated it. Audience
 * scoped so it can never be confused with a normal access token. */
function signLinkIntent({ grudgeId, provider, redirectUri }) {
  return jwt.sign(
    {
      grudge_id: grudgeId,
      provider,
      redirect_uri: redirectUri || null,
      intent: 'link',
      nonce: crypto.randomBytes(8).toString('hex'),
    },
    JWT_SECRET,
    { expiresIn: '5m', audience: 'link-intent' }
  );
}

function verifyLinkIntent(token) {
  const payload = jwt.verify(token, JWT_SECRET, { audience: 'link-intent' });
  if (payload.intent !== 'link') throw new Error('Not a link-intent token');
  return payload;
}

/* ─────────────────────────────────────────────────────────────
 * GET /auth/links
 * Returns every supported provider, marking which ones are
 * currently linked to the authenticated user.
 * ───────────────────────────────────────────────────────────── */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT ${LINK_COLUMNS.join(', ')}
         FROM users WHERE grudge_id = ? LIMIT 1`,
      [req.user.grudge_id]
    );
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'User not found' });

    const providers = Object.entries(PROVIDERS).map(([key, def]) => {
      const value = u[def.column] || null;
      const linked = Boolean(value);

      // Best-effort display label for linked rows.
      let label = null;
      if (linked) {
        if (key === 'discord') label = u.discord_tag || value;
        else if (key === 'github') label = u.github_username || value;
        else if (key === 'puter') label = u.puter_username || value;
        else if (key === 'email') label = u.email;
        else label = value;
      }

      return {
        provider:   key,
        configured: def.isConfigured(),
        oauth:      Boolean(def.isOAuth),
        hint:       def.hint || null,
        linked,
        // For non-OAuth providers we also report the column we'd
        // null on unlink, so the UI knows what to show.
        column:     def.column,
        value,
        label,
      };
    });

    // password_hash is rendered as a synthetic 'password' provider
    // — useful for the UI to know whether the user has a password
    // they could log in with as a fallback.
    providers.push({
      provider:   'password',
      configured: true,
      oauth:      false,
      hint:       'POST /auth/forgot-password to reset',
      linked:     Boolean(u.password_hash) && u.password_hash !== 'guest',
      column:     'password_hash',
      value:      null,
      label:      null,
    });

    res.json({
      providers,
      // Convenience counter for the UI's last-provider safeguard.
      totalLinked: providers.filter(p => p.linked).length,
    });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────────────────────────
 * POST /auth/links/start  { provider, redirect_uri? }
 * Issues a 5-min link-intent JWT bound to the current user
 * and returns the OAuth authorize URL with that JWT as state.
 * Frontend should redirect the browser to `url`.
 * ───────────────────────────────────────────────────────────── */
router.post('/start', requireAuth, (req, res) => {
  const { provider, redirect_uri } = req.body || {};
  const def = PROVIDERS[provider];

  if (!def) return res.status(400).json({ error: `Unknown provider: ${provider}` });
  if (!def.isOAuth) {
    return res.status(400).json({
      error: `Provider '${provider}' is not OAuth-based — use its dedicated endpoint instead`,
      hint:  def.hint || null,
    });
  }
  if (!def.isConfigured()) {
    return res.status(503).json({ error: `Provider '${provider}' is not configured on this server` });
  }

  const state = signLinkIntent({
    grudgeId: req.user.grudge_id,
    provider,
    redirectUri: redirect_uri || null,
  });
  res.json({ url: def.authorizeUrl(state), state });
});

/* ─────────────────────────────────────────────────────────────
 * GET /auth/links/callback/:provider?code&state
 * Provider redirects here after consent. We verify state, fetch
 * the provider profile, then UPDATE users SET <column> = ? WHERE
 * grudge_id = ? — surfacing conflicts via 302 ?status=conflict.
 *
 * This endpoint is intentionally NOT mounted under requireAuth
 * because OAuth providers redirect the browser without our JWT;
 * the link-intent state JWT itself authenticates the request.
 * ───────────────────────────────────────────────────────────── */
router.get('/callback/:provider', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;
  const def = PROVIDERS[provider];

  // Default landing place if state is unverifiable.
  const fallback = process.env.LINK_DEFAULT_REDIRECT
    || 'https://grudgeplatform.io/profile';

  if (!def || !def.isOAuth) {
    return res.redirect(`${fallback}?status=error&detail=unknown_provider`);
  }

  let intent;
  try {
    intent = verifyLinkIntent(state);
  } catch (err) {
    console.warn('[grudge-id:links] invalid state:', err.message);
    return res.redirect(`${fallback}?status=error&detail=bad_state`);
  }
  if (intent.provider !== provider) {
    return res.redirect(`${fallback}?status=error&detail=provider_mismatch`);
  }

  const target  = intent.redirect_uri || fallback;
  const back    = (extras) => {
    const url = new URL(target);
    Object.entries(extras).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    return url.toString();
  };

  if (!code) return res.redirect(back({ status: 'error', detail: 'missing_code' }));

  try {
    const profile = await def.exchangeCode(code);
    const db = getDB();

    // Conflict check — does some OTHER user already own this provider ID?
    const [conflict] = await db.query(
      `SELECT grudge_id FROM users WHERE \`${def.column}\` = ? AND grudge_id != ? LIMIT 1`,
      [profile.providerId, intent.grudge_id]
    );
    if (conflict.length > 0) {
      console.log(`[grudge-id:links] conflict — ${provider} ${profile.providerId} owned by ${conflict[0].grudge_id}`);
      return res.redirect(back({
        status:           'conflict',
        provider,
        conflictGrudgeId: conflict[0].grudge_id,
      }));
    }

    // Apply the link — set the provider column + any extras the provider returned.
    const sets   = [`\`${def.column}\` = ?`];
    const params = [profile.providerId];
    for (const col of (def.extraColumns || [])) {
      const val = profile.extras && profile.extras[col];
      if (val != null) {
        // COALESCE so we never overwrite a value the user already set
        // (e.g. don't replace a custom avatar with the provider's avatar
        // unless the user has none).
        sets.push(`\`${col}\` = COALESCE(\`${col}\`, ?)`);
        params.push(val);
      }
    }
    params.push(intent.grudge_id);

    await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE grudge_id = ?`,
      params
    );

    console.log(`[grudge-id:links] linked ${provider} → ${intent.grudge_id}`);
    return res.redirect(back({ status: 'linked', provider }));
  } catch (err) {
    console.error(`[grudge-id:links] callback ${provider} error:`, err.message);
    return res.redirect(back({ status: 'error', detail: 'callback_failed' }));
  }
});

/* ─────────────────────────────────────────────────────────────
 * DELETE /auth/links/:provider
 * Unlink a provider from the authenticated user. Refuses if it
 * would leave the user with zero auth methods.
 * ───────────────────────────────────────────────────────────── */
router.delete('/:provider', requireAuth, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const def = PROVIDERS[provider];
    if (!def) return res.status(400).json({ error: `Unknown provider: ${provider}` });

    const db = getDB();
    const [rows] = await db.query(
      `SELECT ${LINK_COLUMNS.join(', ')} FROM users WHERE grudge_id = ? LIMIT 1`,
      [req.user.grudge_id]
    );
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'User not found' });

    if (!u[def.column]) {
      return res.status(404).json({ error: 'Provider is not linked' });
    }

    // Last-provider safeguard — count how many auth methods the user
    // has BESIDES the one they're trying to unlink.
    const otherProviders = Object.values(PROVIDERS).filter(p => p.column !== def.column);
    const remaining = otherProviders.filter(p => Boolean(u[p.column])).length
      + (u.password_hash && u.password_hash !== 'guest' ? 1 : 0);
    if (remaining < 1) {
      return res.status(409).json({
        error: 'Cannot unlink your only sign-in method',
        reason: 'last-provider',
      });
    }

    // Null out the provider column. Don't touch extras (display name,
    // avatar) — the user may want to keep their profile picture.
    await db.query(
      `UPDATE users SET \`${def.column}\` = NULL WHERE grudge_id = ?`,
      [req.user.grudge_id]
    );

    console.log(`[grudge-id:links] unlinked ${provider} from ${req.user.grudge_id}`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────────────────────────
 * POST /auth/links/merge  { otherToken }
 * Merge another Grudge account (proven by valid access token)
 * INTO the currently-authenticated account. The other account
 * is the SOURCE — it's drained and deleted. Current account
 * is the TARGET — it survives and absorbs the source's data.
 *
 * Conservative scope: only operates on tables in the auth DB.
 * Game-data services that store rows by grudge_id can listen
 * for the user.merged event we may emit in a future iteration.
 * ───────────────────────────────────────────────────────────── */
router.post('/merge', requireAuth, async (req, res, next) => {
  try {
    const { otherToken } = req.body || {};
    if (!otherToken) return res.status(400).json({ error: 'otherToken required' });

    let otherPayload;
    try { otherPayload = jwt.verify(otherToken, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Invalid or expired otherToken' }); }

    const targetGrudgeId = req.user.grudge_id;
    const sourceGrudgeId = otherPayload.grudge_id;

    if (!sourceGrudgeId) return res.status(400).json({ error: 'otherToken missing grudge_id' });
    if (sourceGrudgeId === targetGrudgeId) {
      return res.json({ ok: true, reason: 'same-user' });
    }

    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [tgtRows] = await conn.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [targetGrudgeId]);
      const [srcRows] = await conn.query('SELECT * FROM users WHERE grudge_id = ? LIMIT 1', [sourceGrudgeId]);
      const tgt = tgtRows[0];
      const src = srcRows[0];

      if (!tgt || !src) {
        await conn.rollback();
        return res.status(404).json({ error: 'user-not-found' });
      }

      // 1. Copy any provider columns the source has that the target doesn't.
      const colsToCopy = [];
      const valsToCopy = [];
      for (const def of Object.values(PROVIDERS)) {
        if (src[def.column] && !tgt[def.column]) {
          colsToCopy.push(`\`${def.column}\` = ?`);
          valsToCopy.push(src[def.column]);
        }
      }
      // Also copy display extras the target is missing.
      for (const col of ['discord_tag', 'github_username', 'puter_username', 'avatar_url']) {
        if (src[col] && !tgt[col]) {
          colsToCopy.push(`\`${col}\` = ?`);
          valsToCopy.push(src[col]);
        }
      }
      if (colsToCopy.length) {
        valsToCopy.push(targetGrudgeId);
        await conn.query(
          `UPDATE users SET ${colsToCopy.join(', ')} WHERE grudge_id = ?`,
          valsToCopy
        );
      }

      // 2. Reassign rows in dependent tables that key on grudge_id.
      //    Only touch tables we know exist on the canonical schema —
      //    if a table is missing or has no grudge_id column, skip it
      //    (the IGNORE prevents a single missing table from aborting).
      const dependentTables = [
        'characters', 'inventory', 'inventory_log',
        'cloud_saves', 'computer_registrations', 'grudge_devices',
        'profession_progress', 'island_state', 'player_islands',
        'gold_transactions', 'crafting_queue',
        'friendships', 'crew_members',
        'pvp_lobby_players', 'pvp_ratings', 'arena_teams',
        'notifications', 'user_achievements', 'user_profiles',
        'gouldstones', 'launch_tokens',
      ];
      const reassignedCounts = {};
      for (const tbl of dependentTables) {
        try {
          const [r] = await conn.query(
            `UPDATE IGNORE \`${tbl}\` SET grudge_id = ? WHERE grudge_id = ?`,
            [targetGrudgeId, sourceGrudgeId]
          );
          if (r.affectedRows > 0) reassignedCounts[tbl] = r.affectedRows;
          // Drop any rows that couldn't be reassigned (UPDATE IGNORE silently
          // skips on duplicate-key conflicts — those would have been duplicates
          // of target rows anyway). Then delete remaining source rows so the
          // table doesn't hold orphans referencing the soon-deleted user.
          await conn.query(`DELETE FROM \`${tbl}\` WHERE grudge_id = ?`, [sourceGrudgeId]);
        } catch (err) {
          // Table doesn't exist or doesn't have grudge_id — that's fine, skip.
          if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') {
            console.warn(`[grudge-id:links] merge skip table=${tbl} reason=${err.code}`);
          }
        }
      }

      // 3. Delete the source user. With provider columns now belonging
      //    to the target (or NULL), there are no unique-key collisions.
      await conn.query('DELETE FROM users WHERE grudge_id = ?', [sourceGrudgeId]);

      await conn.commit();
      console.log(`[grudge-id:links] merged ${sourceGrudgeId} → ${targetGrudgeId}`);
      res.json({ ok: true, providersCopied: colsToCopy.length, reassignedCounts });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
