"use strict";

const { Router } = require("express");

const router = Router();

/**
 * POST /auth/phone/send
 * Phase 3 — Send OTP via Twilio.
 */
router.post("/send", (_req, res) => {
  res.status(501).json({ error: "Phone auth not configured yet (Phase 3)" });
});

/**
 * POST /auth/phone/verify
 * Phase 3 — Verify OTP.
 */
router.post("/verify", (_req, res) => {
  res.status(501).json({ error: "Phone auth not configured yet (Phase 3)" });
});

module.exports = router;
