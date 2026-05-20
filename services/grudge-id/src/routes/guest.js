"use strict";

const { Router } = require("express");
const { nanoid } = require("nanoid");
const { createWithProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");
const { requireTurnstile } = require("../middleware/turnstile");

const router = Router();

/**
 * POST /auth/guest
 * Body: { turnstileToken }
 * Creates an anonymous guest account. Can be claimed later.
 */
router.post("/", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const guestTag = nanoid(8);
    const user = await createWithProvider({
      provider: "guest",
      providerUid: `guest-${guestTag}`,
      displayName: `Guest_${guestTag}`,
      isGuest: true,
    });

    const token = signAccess(user);

    console.log(`[AUTH] Guest created: ${user.display_name} (${user.grudge_id})`);

    res.status(201).json({
      ok: true,
      token,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      isGuest: true,
      provider: "guest",
    });
  } catch (err) {
    console.error("[GUEST] Error:", err);
    res.status(500).json({ error: "Guest account creation failed" });
  }
});

module.exports = router;
