"use strict";

const { verifyAccess } = require("../services/jwt");

/**
 * Middleware — requires a valid Grudge JWT in Authorization header.
 * Sets req.user = { userId, grudgeId, displayName }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccess(token);
    req.user = {
      userId: payload.sub,
      grudgeId: payload.grudgeId,
      displayName: payload.name,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
