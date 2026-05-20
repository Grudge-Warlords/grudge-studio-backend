"use strict";

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { findById, getProviders } = require("../services/user");

const router = Router();

/**
 * GET /auth/verify
 * Validates the JWT in Authorization header and returns user info.
 * Used by all Grudge apps to check if a stored token is still valid.
 */
router.get("/verify", requireAuth, async (req, res) => {
  try {
    const user = await findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const providers = await getProviders(user.id);

    res.json({
      ok: true,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_url,
      isGuest: Boolean(user.is_guest),
      providers: providers.map((p) => p.provider),
    });
  } catch (err) {
    console.error("[VERIFY] Error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

/**
 * POST /auth/logout
 * Placeholder — JWT is stateless, so logout is client-side.
 * This endpoint exists for future refresh-token revocation.
 */
router.post("/logout", (_req, res) => {
  res.json({ ok: true, message: "Logged out — clear token on client" });
});

module.exports = router;
