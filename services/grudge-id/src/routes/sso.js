"use strict";
const { Router } = require("express");
const router = Router();

/**
 * GET /auth/sso-check?return=URL
 * Called by grudge-platform's redirectToLogin().
 * Redirects to the auth page with the return URL preserved.
 */
router.get("/sso-check", (req, res) => {
  const returnUrl = req.query.return || "https://grudgewarlords.com";
  const authUrl = `https://id.grudge-studio.com/auth?redirect=${encodeURIComponent(returnUrl)}`;
  res.redirect(authUrl);
});

module.exports = router;
