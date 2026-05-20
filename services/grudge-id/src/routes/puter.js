"use strict";

const { Router } = require("express");
const { findOrCreateByProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");

const router = Router();

/**
 * POST /auth/puter-bridge
 * Body: { puterToken, puterUid, puterUsername, puterEmail }
 *
 * Called by the auth frontend after Puter.js SDK authenticates the user.
 * The frontend gets puter session data from puter.auth.getUser() and sends
 * it here. We trust puter.js SDK tokens (they're validated client-side by
 * the Puter SDK itself), and create/find a matching Grudge account.
 *
 * In production, you could optionally verify the puterToken against Puter's
 * API, but for now the token is used as a pass-through.
 */
router.post("/", authLimiter, async (req, res) => {
  try {
    const { puterToken, puterUid, puterUsername, puterEmail } = req.body;

    if (!puterUid) {
      return res.status(400).json({ error: "Missing puterUid" });
    }

    const { user, created } = await findOrCreateByProvider({
      provider: "puter",
      providerUid: puterUid,
      displayName: puterUsername || `Puter_${puterUid.slice(0, 6)}`,
      email: puterEmail || null,
      providerData: {
        puterUsername,
        puterUid,
        linkedAt: new Date().toISOString(),
      },
    });

    const token = signAccess(user);

    console.log(
      `[AUTH] Puter ${created ? "register" : "login"}: ${user.display_name} (${user.grudge_id})`
    );

    res.json({
      ok: true,
      token,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      provider: "puter",
      created,
    });
  } catch (err) {
    console.error("[PUTER] Bridge error:", err);
    res.status(500).json({ error: "Puter bridge authentication failed" });
  }
});

module.exports = router;
