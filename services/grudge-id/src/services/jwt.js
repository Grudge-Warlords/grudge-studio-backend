"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cfg = require("../config");

/**
 * Sign an access token (short-lived).
 * Payload: { sub: userId, grudgeId, name }
 */
function signAccess(user) {
  return jwt.sign(
    {
      sub: user.id,
      grudgeId: user.grudge_id,
      name: user.display_name,
    },
    cfg.jwt.secret,
    { expiresIn: cfg.jwt.accessExpiresIn, issuer: "grudge-id" }
  );
}

/**
 * Sign a refresh token (long-lived).
 */
function signRefresh(user) {
  return jwt.sign(
    { sub: user.id, type: "refresh" },
    cfg.jwt.secret,
    { expiresIn: cfg.jwt.refreshExpiresIn, issuer: "grudge-id" }
  );
}

/** Verify an access token. Returns decoded payload or throws. */
function verifyAccess(token) {
  return jwt.verify(token, cfg.jwt.secret, { issuer: "grudge-id" });
}

/** Verify a refresh token. Returns decoded payload or throws. */
function verifyRefresh(token) {
  const payload = jwt.verify(token, cfg.jwt.secret, { issuer: "grudge-id" });
  if (payload.type !== "refresh") throw new Error("Not a refresh token");
  return payload;
}

/** Generate a cryptographically random refresh token string. */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

/* ── Link-intent tokens ─────────────────────────────────────
 * Used as the OAuth `state` param when a logged-in user starts
 * linking a NEW provider to their existing Grudge ID. The JWT
 * carries the user_id and the provider being linked, signed and
 * scoped via audience='link-intent' so it can never be confused
 * with a normal access token.
 */
function signLinkIntent({ userId, provider, redirect }) {
  return jwt.sign(
    {
      sub: String(userId),
      provider,
      redirect: redirect || null,
      intent: "link",
    },
    cfg.jwt.secret,
    {
      expiresIn: "5m",
      issuer: "grudge-id",
      audience: "link-intent",
    }
  );
}

function verifyLinkIntent(token) {
  const payload = jwt.verify(token, cfg.jwt.secret, {
    issuer: "grudge-id",
    audience: "link-intent",
  });
  if (payload.intent !== "link") throw new Error("Not a link-intent token");
  return payload;
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  generateRefreshToken,
  signLinkIntent,
  verifyLinkIntent,
};
