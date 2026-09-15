"use strict";

const cfg = require("../config");

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Middleware — verifies Cloudflare Turnstile token from body.turnstileToken.
 * Skips verification in development or if Turnstile is not configured.
 */
async function requireTurnstile(req, res, next) {
  // Skip if not configured (dev mode)
  if (!cfg.turnstile.secretKey) return next();

  const token = req.body?.turnstileToken;
  if (!token) {
    return res.status(400).json({ error: "Missing turnstileToken" });
  }

  try {
    const resp = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: cfg.turnstile.secretKey,
        response: token,
        remoteip: req.ip,
      }),
    });
    const data = await resp.json();
    if (!data.success) {
      console.warn("[TURNSTILE] Verification failed:", data["error-codes"]);
      return res.status(403).json({ error: "Captcha verification failed" });
    }
    next();
  } catch (err) {
    console.error("[TURNSTILE] Error:", err.message);
    // Fail open in case Cloudflare is down — but log it
    next();
  }
}

module.exports = { requireTurnstile };
