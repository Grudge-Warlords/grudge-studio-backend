"use strict";

const { Router } = require("express");
const crypto = require("crypto");
const cfg = require("../config");
const { findOrCreateByProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");

const router = Router();
const stateStore = new Map();

/**
 * GET /auth/github
 * Phase 2 — GitHub OAuth2 code flow.
 */
router.get("/", (req, res) => {
  if (!cfg.github.clientId) {
    return res.status(501).json({ error: "GitHub OAuth not configured yet (Phase 2)" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, {
    redirect: req.query.redirect || cfg.defaultRedirect,
    app: req.query.app || "",
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: cfg.github.clientId,
    redirect_uri: cfg.github.redirectUri,
    scope: "read:user user:email",
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /auth/github/callback
 */
router.get("/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;
  const stored = stateStore.get(state);
  if (!stored) return res.status(400).json({ error: "Invalid or expired state" });
  stateStore.delete(state);

  try {
    // Exchange code for access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: cfg.github.clientId,
        client_secret: cfg.github.clientSecret,
        code,
        redirect_uri: cfg.github.redirectUri,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: "GitHub token exchange failed" });
    }

    // Fetch user info
    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "GrudgeStudio-Auth",
      },
    });
    const ghUser = await userResp.json();

    // Fetch primary email
    let email = null;
    const emailResp = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "GrudgeStudio-Auth",
      },
    });
    const emails = await emailResp.json();
    if (Array.isArray(emails)) {
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary ? primary.email : null;
    }

    const { user } = await findOrCreateByProvider({
      provider: "github",
      providerUid: String(ghUser.id),
      displayName: ghUser.name || ghUser.login,
      email,
      avatarUrl: ghUser.avatar_url || null,
      providerData: { login: ghUser.login, githubId: ghUser.id },
    });

    const token = signAccess(user);
    console.log(`[AUTH] GitHub login: ${user.display_name} (${user.grudge_id})`);

    const redirectUrl = new URL(stored.redirect);
    redirectUrl.hash = new URLSearchParams({
      token,
      grudgeId: user.grudge_id,
      name: user.display_name,
      provider: "github",
    }).toString();

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("[GITHUB] OAuth error:", err);
    res.status(500).json({ error: "GitHub authentication failed" });
  }
});

module.exports = router;
