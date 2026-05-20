"use strict";

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { linkProvider, getProviders, claimGuest } = require("../services/user");
const { authLimiter } = require("../middleware/rateLimit");
const bcrypt = require("bcrypt");

const router = Router();

/**
 * POST /auth/link
 * Body: { provider, providerUid, providerData }
 * Links an additional auth method to the logged-in user's account.
 * Requires valid JWT in Authorization header.
 */
router.post("/", requireAuth, authLimiter, async (req, res) => {
  try {
    const { provider, providerUid, providerData } = req.body;

    if (!provider || !providerUid) {
      return res.status(400).json({ error: "Missing provider or providerUid" });
    }

    const valid = ["puter", "discord", "google", "github", "wallet", "phone", "email"];
    if (!valid.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider: ${provider}` });
    }

    await linkProvider(req.user.userId, provider, providerUid, providerData);

    const providers = await getProviders(req.user.userId);

    console.log(`[AUTH] Linked ${provider} to ${req.user.grudgeId}`);

    res.json({
      ok: true,
      providers: providers.map((p) => p.provider),
    });
  } catch (err) {
    console.error("[LINK] Error:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "This provider account is already linked to another user" });
    }
    res.status(500).json({ error: "Failed to link provider" });
  }
});

/**
 * POST /auth/link/claim
 * Body: { email, password, displayName }
 * Upgrades a guest account to a full account with email/password.
 */
router.post("/claim", requireAuth, authLimiter, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await claimGuest(req.user.userId, email.toLowerCase(), passwordHash, displayName || email.split("@")[0]);

    // Also link email as a provider
    await linkProvider(req.user.userId, "email", email.toLowerCase(), null);

    console.log(`[AUTH] Guest claimed: ${req.user.grudgeId} -> ${email}`);

    res.json({ ok: true, message: "Account claimed successfully" });
  } catch (err) {
    console.error("[CLAIM] Error:", err);
    res.status(500).json({ error: "Failed to claim account" });
  }
});

module.exports = router;
