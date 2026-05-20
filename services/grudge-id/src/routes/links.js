"use strict";

/* ============================================================
 * /auth/links/*  (plural) — Link-providers flow
 * ------------------------------------------------------------
 * Lets a logged-in user attach ADDITIONAL auth providers to
 * their existing Grudge ID instead of accidentally creating a
 * second account, and merge two existing Grudge IDs together.
 *
 * Routes mounted at /auth/links/* in index.js. The legacy
 * single-link route /auth/link (singular) in routes/link.js
 * is left untouched for backward compatibility.
 *
 * Endpoints:
 *   GET    /auth/links                                — list providers linked to me
 *   POST   /auth/links/start                          — start linking a new provider
 *   GET    /auth/links/callback/:provider             — OAuth callback (link-intent state)
 *   DELETE /auth/links/:provider/:providerUid         — unlink a provider
 *   POST   /auth/links/merge                          — merge another Grudge ID into mine
 * ============================================================ */

const { Router } = require("express");
const crypto = require("crypto");
const cfg = require("../config");
const { requireAuth } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");
const {
  attachProviderToUser,
  unlinkProvider,
  mergeUsers,
  getProvidersDetailed,
  findById,
} = require("../services/user");
const {
  signLinkIntent,
  verifyLinkIntent,
  verifyAccess,
} = require("../services/jwt");

const router = Router();

/* ── Provider catalogue ───────────────────────────────────────
 * Drives both POST /auth/links/start (which OAuth URL to issue)
 * and the Profile UI (which providers to display).
 * Each entry knows how to:
 *   - build its OAuth authorize URL (or report it isn't OAuth-based)
 *   - exchange a `code` for a profile during callback
 * Providers without a clientId at runtime are advertised as
 * "not configured" so the UI can hide them.
 */
const PROVIDERS = {
  discord: {
    isOAuth: true,
    isConfigured: () => Boolean(cfg.discord.clientId),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id: cfg.discord.clientId,
        // We use a dedicated link callback so we never confuse
        // a link-intent state with a normal login state.
        redirect_uri: linkCallbackUrl("discord"),
        response_type: "code",
        scope: "identify email",
        state,
        prompt: "none",
      });
      return `https://discord.com/oauth2/authorize?${params}`;
    },
    fetchProfile: async (code) => {
      const tokenResp = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.discord.clientId,
          client_secret: cfg.discord.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: linkCallbackUrl("discord"),
        }),
      });
      const tokenData = await tokenResp.json();
      if (!tokenData.access_token) throw new Error("Discord token exchange failed");

      const userResp = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const u = await userResp.json();
      if (!u.id) throw new Error("Discord profile fetch failed");

      return {
        providerUid: u.id,
        providerEmail: u.email || null,
        providerData: {
          username: u.username,
          discriminator: u.discriminator,
          global_name: u.global_name,
          avatar: u.avatar,
        },
      };
    },
  },
  google: {
    isOAuth: true,
    isConfigured: () => Boolean(cfg.google.clientId),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id: cfg.google.clientId,
        redirect_uri: linkCallbackUrl("google"),
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },
    fetchProfile: async (code) => {
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.google.clientId,
          client_secret: cfg.google.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: linkCallbackUrl("google"),
        }),
      });
      const tokenData = await tokenResp.json();
      if (!tokenData.access_token) throw new Error("Google token exchange failed");

      const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const u = await userResp.json();
      if (!u.id) throw new Error("Google profile fetch failed");

      return {
        providerUid: u.id,
        providerEmail: u.email || null,
        providerData: { name: u.name, picture: u.picture, email: u.email },
      };
    },
  },
  github: {
    isOAuth: true,
    isConfigured: () => Boolean(cfg.github.clientId),
    authorizeUrl: (state) => {
      const params = new URLSearchParams({
        client_id: cfg.github.clientId,
        redirect_uri: linkCallbackUrl("github"),
        scope: "read:user user:email",
        state,
        allow_signup: "false",
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    },
    fetchProfile: async (code) => {
      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: cfg.github.clientId,
          client_secret: cfg.github.clientSecret,
          code,
          redirect_uri: linkCallbackUrl("github"),
        }),
      });
      const tokenData = await tokenResp.json();
      if (!tokenData.access_token) throw new Error("GitHub token exchange failed");

      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "User-Agent": "grudge-id",
        },
      });
      const u = await userResp.json();
      if (!u.id) throw new Error("GitHub profile fetch failed");

      // GitHub email may be null — fetch from /user/emails as fallback.
      let email = u.email;
      if (!email) {
        const eResp = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "User-Agent": "grudge-id",
          },
        });
        const emails = await eResp.json();
        const primary = Array.isArray(emails)
          ? emails.find((e) => e.primary && e.verified)
          : null;
        email = primary ? primary.email : null;
      }

      return {
        providerUid: String(u.id),
        providerEmail: email,
        providerData: { login: u.login, name: u.name, avatar_url: u.avatar_url },
      };
    },
  },
  // Non-OAuth providers (wallet/phone/puter/email) are linked through
  // their own bespoke endpoints — they're advertised here so the UI
  // can list them, but POST /auth/links/start refuses them with
  // a hint pointing to the right entry endpoint.
  wallet: { isOAuth: false, isConfigured: () => true, hint: "POST /auth/wallet/link" },
  phone: { isOAuth: false, isConfigured: () => true, hint: "POST /auth/phone/send + /auth/phone/verify" },
  puter: { isOAuth: false, isConfigured: () => true, hint: "POST /auth/puter-bridge/link" },
  email: { isOAuth: false, isConfigured: () => true, hint: "POST /auth/link/claim" },
};

/** Build the absolute callback URL for a given provider. */
function linkCallbackUrl(provider) {
  // We use the same host the provider redirect URIs are registered against,
  // but on a dedicated /auth/links/callback/:provider path so the link-intent
  // state is never confused with a normal login state.
  const base = (cfg[provider] && cfg[provider].redirectUri)
    ? cfg[provider].redirectUri.replace(/\/auth\/[^/]+\/callback$/, "")
    : "https://id.grudge-studio.com";
  return `${base}/auth/links/callback/${provider}`;
}

/* ─────────────────────────────────────────────────────────────
 * GET /auth/links
 * Returns all providers linked to the authenticated user.
 * ───────────────────────────────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await getProvidersDetailed(req.user.userId);

    // Build the union of "linked" rows + every provider in PROVIDERS
    // so the UI can render Link/Unlink for every supported provider.
    const linkedByProvider = new Map();
    for (const row of rows) {
      if (!linkedByProvider.has(row.provider)) linkedByProvider.set(row.provider, []);
      linkedByProvider.get(row.provider).push({
        providerUid: row.provider_uid,
        providerEmail: row.provider_email || null,
        linkedAt: row.linked_at,
        lastLoginAt: row.last_login_at,
        metadata: parseJsonSafe(row.provider_data),
      });
    }

    const providers = Object.keys(PROVIDERS).map((key) => {
      const def = PROVIDERS[key];
      return {
        provider: key,
        configured: def.isConfigured(),
        oauth: def.isOAuth,
        hint: def.hint || null,
        links: linkedByProvider.get(key) || [],
      };
    });

    res.json({ providers });
  } catch (err) {
    console.error("[LINKS] list error:", err);
    res.status(500).json({ error: "Failed to list links" });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /auth/links/start  { provider, redirect? }
 * Issues a 5-min link-intent JWT bound to the current user
 * and returns the OAuth authorize URL with that JWT as state.
 * Frontend should redirect the browser to `authorizeUrl`.
 * ───────────────────────────────────────────────────────────── */
router.post("/start", requireAuth, authLimiter, (req, res) => {
  try {
    const { provider, redirect } = req.body || {};
    const def = PROVIDERS[provider];

    if (!def) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!def.isOAuth) {
      return res.status(400).json({
        error: `Provider '${provider}' is not OAuth-based`,
        hint: def.hint,
      });
    }
    if (!def.isConfigured()) {
      return res.status(503).json({ error: `Provider '${provider}' is not configured on this server` });
    }

    const state = signLinkIntent({
      userId: req.user.userId,
      provider,
      redirect: redirect || null,
    });
    const authorizeUrl = def.authorizeUrl(state);
    res.json({ ok: true, authorizeUrl, state });
  } catch (err) {
    console.error("[LINKS] start error:", err);
    res.status(500).json({ error: "Failed to start link flow" });
  }
});

/* ─────────────────────────────────────────────────────────────
 * GET /auth/links/callback/:provider?code&state
 * The provider redirects here when the user finishes consenting.
 * `state` is the link-intent JWT we issued in /start.
 *
 * On success → 302 to redirect URL with ?status=linked
 * On conflict → 302 with ?status=conflict&conflictUserId=…
 * On error → 302 with ?status=error&detail=…
 * ───────────────────────────────────────────────────────────── */
router.get("/callback/:provider", authLimiter, async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;
  const def = PROVIDERS[provider];

  // Default landing place if state is unverifiable.
  const fallback = "https://grudgeplatform.io/profile";

  if (!def || !def.isOAuth) {
    return res.redirect(`${fallback}?status=error&detail=unknown_provider`);
  }

  let intent;
  try {
    intent = verifyLinkIntent(state);
  } catch (err) {
    console.warn("[LINKS] invalid state token:", err.message);
    return res.redirect(`${fallback}?status=error&detail=bad_state`);
  }
  if (intent.provider !== provider) {
    return res.redirect(`${fallback}?status=error&detail=provider_mismatch`);
  }

  const userId = parseInt(intent.sub, 10);
  const target = intent.redirect || fallback;
  const back = (extra) => {
    const url = new URL(target);
    Object.entries(extra).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    return url.toString();
  };

  try {
    if (!code) return res.redirect(back({ status: "error", detail: "missing_code" }));

    const profile = await def.fetchProfile(code);
    const result = await attachProviderToUser({
      userId,
      provider,
      providerUid: profile.providerUid,
      providerEmail: profile.providerEmail,
      providerData: profile.providerData,
    });

    if (result.wasLinked) {
      console.log(`[LINKS] linked ${provider} to user ${userId}`);
      return res.redirect(back({ status: "linked", provider }));
    }
    if (result.alreadyLinked) {
      return res.redirect(back({ status: "already_linked", provider }));
    }
    if (result.conflictUserId) {
      console.log(`[LINKS] conflict — ${provider}/${profile.providerUid} belongs to user ${result.conflictUserId}`);
      return res.redirect(back({
        status: "conflict",
        provider,
        conflictUserId: String(result.conflictUserId),
      }));
    }
    return res.redirect(back({ status: "error", detail: "unknown" }));
  } catch (err) {
    console.error(`[LINKS] callback ${provider} error:`, err);
    return res.redirect(back({ status: "error", detail: "callback_failed" }));
  }
});

/* ─────────────────────────────────────────────────────────────
 * DELETE /auth/links/:provider/:providerUid
 * Unlink a provider account from the authenticated user.
 * Refuses if it's the user's only remaining auth method.
 * ───────────────────────────────────────────────────────────── */
router.delete("/:provider/:providerUid", requireAuth, async (req, res) => {
  try {
    const { provider, providerUid } = req.params;
    const result = await unlinkProvider(req.user.userId, provider, providerUid);
    if (!result.unlinked) {
      const status = result.reason === "last-provider" ? 409 : 404;
      return res.status(status).json({ error: result.reason });
    }
    console.log(`[LINKS] unlinked ${provider}/${providerUid} from user ${req.user.userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[LINKS] unlink error:", err);
    res.status(500).json({ error: "Failed to unlink provider" });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /auth/links/merge  { otherToken }
 * Merge another Grudge account (proven by valid access token) INTO
 * the currently-authenticated account. The "other" account is the
 * source — it's drained of its provider links and then deleted.
 *
 * The current account is the target — it survives. All providers
 * from `otherToken`'s account are reassigned to it (skipping any
 * (provider, provider_uid) that are already linked to it).
 *
 * Idempotent: merging a token for the same account is a no-op.
 * ───────────────────────────────────────────────────────────── */
router.post("/merge", requireAuth, authLimiter, async (req, res) => {
  try {
    const { otherToken } = req.body || {};
    if (!otherToken) return res.status(400).json({ error: "Missing otherToken" });

    let otherPayload;
    try {
      otherPayload = verifyAccess(otherToken);
    } catch {
      return res.status(401).json({ error: "Invalid or expired otherToken" });
    }

    const otherUserId = parseInt(otherPayload.sub, 10);
    const result = await mergeUsers(req.user.userId, otherUserId);
    if (!result.merged) {
      const status = result.reason === "same-user" ? 200 : 404;
      return res.status(status).json({ ok: result.reason === "same-user", reason: result.reason });
    }

    console.log(`[LINKS] merged user ${otherUserId} → ${req.user.userId}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[LINKS] merge error:", err);
    res.status(500).json({ error: "Merge failed" });
  }
});

/* ── Helpers ─────────────────────────────────────────────────── */
function parseJsonSafe(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

module.exports = router;
