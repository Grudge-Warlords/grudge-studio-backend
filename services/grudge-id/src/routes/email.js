"use strict";

const { Router } = require("express");
const bcrypt = require("bcrypt");
const { findByEmail, findOrCreateByProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");
const { requireTurnstile } = require("../middleware/turnstile");

const router = Router();
const SALT_ROUNDS = 12;

/**
 * POST /auth/register
 * Body: { email, password, displayName, turnstileToken }
 */
router.post("/register", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Check if email already exists
    const existing = await findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { user } = await findOrCreateByProvider({
      provider: "email",
      providerUid: email.toLowerCase(),
      displayName: displayName || email.split("@")[0],
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = signAccess(user);

    console.log(`[AUTH] Email register: ${user.display_name} (${user.grudge_id})`);

    res.status(201).json({
      ok: true,
      token,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      provider: "email",
    });
  } catch (err) {
    console.error("[EMAIL] Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /auth/login
 * Body: { email, password, turnstileToken }
 */
router.post("/login", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await findByEmail(email.toLowerCase());
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signAccess(user);

    console.log(`[AUTH] Email login: ${user.display_name} (${user.grudge_id})`);

    res.json({
      ok: true,
      token,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      provider: "email",
    });
  } catch (err) {
    console.error("[EMAIL] Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
