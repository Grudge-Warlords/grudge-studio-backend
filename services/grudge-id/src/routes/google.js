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
 * GET /auth/google
 * Phase 2 — Google OAuth2 code flow.
 */
router.get("/", (req, res) => {
  if (!cfg.google.clientId) {
    return res.status(501).json({ error: "Google OAuth not configured yet (Phase 2)" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, {
    redirect: req.query.redirect || cfg.defaultRedirect,
    app: req.query.app || "",
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: cfg.google.clientId,
    redirect_uri: cfg.google.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * GET /auth/google/callback
 */
router.get("/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;
  const stored = stateStore.get(state);
  if (!stored) return res.status(400).json({ error: "Invalid or expired state" });
  stateStore.delete(state);

  try {
    // Exchange code for tokens
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.google.clientId,
        client_secret: cfg.google.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: cfg.google.redirectUri,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: "Google token exchange failed" });
    }

    // Fetch user info
    const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userResp.json();

    const { user } = await findOrCreateByProvider({
      provider: "google",
      providerUid: googleUser.id,
      displayName: googleUser.name || googleUser.email.split("@")[0],
      email: googleUser.email,
      avatarUrl: googleUser.picture || null,
      providerData: { googleId: googleUser.id, email: googleUser.email },
    });

    const token = signAccess(user);
    console.log(`[AUTH] Google login: ${user.display_name} (${user.grudge_id})`);

    const redirectUrl = new URL(stored.redirect);
    redirectUrl.hash = new URLSearchParams({
      token,
      grudgeId: user.grudge_id,
      name: user.display_name,
      provider: "google",
    }).toString();

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("[GOOGLE] OAuth error:", err);
    res.status(500).json({ error: "Google authentication failed" });
  }
});

module.exports = router;
