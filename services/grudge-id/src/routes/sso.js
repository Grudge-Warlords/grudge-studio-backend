"use strict";

const { Router } = require("express");
const cfg = require("../config");

const router = Router();

/**
 * GET /auth/sso-check?return=URL
 *
 * Called by grudge-platform's redirectToLogin().
 * Redirects to the auth page with the return URL preserved.
 * After auth completes, the auth page redirects back to the return URL
 * with the token in the hash fragment.
 */
router.get("/sso-check", (req, res) => {
  const returnUrl = req.query.return || cfg.defaultRedirect;
  const authUrl = `${cfg.authFrontendUrl}?redirect=${encodeURIComponent(returnUrl)}`;
  res.redirect(authUrl);
});

module.exports = router;
