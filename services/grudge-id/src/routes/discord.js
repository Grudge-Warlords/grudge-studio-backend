"use strict";

const { Router } = require("express");
const crypto = require("crypto");
const cfg = require("../config");
const { findOrCreateByProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");

const router = Router();

const DISCORD_API = "https://discord.com/api/v10";
const SCOPES = "identify email";

// In-memory state store (short-lived, 10 min TTL)
const stateStore = new Map();

/**
 * GET /auth/discord
 * Redirects user to Discord's OAuth2 authorize page.
 * Query: ?redirect=URL&app=SLUG
 */
router.get("/", (req, res) => {
  if (!cfg.discord.clientId) {
    return res.status(503).json({ error: "Discord OAuth not configured" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, {
    redirect: req.query.redirect || cfg.defaultRedirect,
    app: req.query.app || "",
    createdAt: Date.now(),
  });

  // Expire old states every request (lazy cleanup)
  for (const [k, v] of stateStore) {
    if (Date.now() - v.createdAt > 600_000) stateStore.delete(k);
  }

  const params = new URLSearchParams({
    client_id: cfg.discord.clientId,
    redirect_uri: cfg.discord.redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    prompt: "none",
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

/**
 * GET /auth/discord/callback
 * Discord redirects here with ?code=&state=
 */
router.get("/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;

  // Validate state
  const stored = stateStore.get(state);
  if (!stored) {
    return res.status(400).json({ error: "Invalid or expired state" });
  }
  stateStore.delete(state);

  try {
    // Exchange code for access token
    const tokenResp = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.discord.clientId,
        client_secret: cfg.discord.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.discord.redirectUri,
      }),
    });

    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      console.error("[DISCORD] Token exchange failed:", tokenData);
      return res.status(400).json({ error: "Discord token exchange failed" });
    }

    // Fetch user info
    const userResp = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userResp.json();

    if (!discordUser.id) {
      return res.status(400).json({ error: "Failed to fetch Discord user" });
    }

    // Find or create Grudge account
    const { user } = await findOrCreateByProvider({
      provider: "discord",
      providerUid: discordUser.id,
      displayName: discordUser.global_name || discordUser.username,
      email: discordUser.email || null,
      avatarUrl: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      providerData: {
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
      },
    });

    const token = signAccess(user);

    console.log(`[AUTH] Discord login: ${user.display_name} (${user.grudge_id})`);

    // Redirect back to the calling app with token in hash fragment
    const redirectUrl = new URL(stored.redirect);
    redirectUrl.hash = new URLSearchParams({
      token,
      grudgeId: user.grudge_id,
      name: user.display_name,
      provider: "discord",
    }).toString();

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("[DISCORD] OAuth error:", err);
    res.status(500).json({ error: "Discord authentication failed" });
  }
});

module.exports = router;
