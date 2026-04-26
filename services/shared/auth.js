/**
 * shared/auth.js — Single source of truth for Grudge JWT auth middleware.
 * Used by: game-api, account-api, launcher-api, asset-service, ws-service
 */
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

/** Role hierarchy: guest < pleb < member < admin < master */
const ROLES = { guest: 0, pleb: 1, member: 2, admin: 3, master: 4 };

/* ── helpers ─────────────────────────────────────────────── */

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

function isAdmin(req) {
  return req.user && (req.user.role === "admin" || req.user.role === "master");
}

function isMaster(req) {
  return req.user && req.user.role === "master";
}

/* ── core middleware ──────────────────────────────────────── */

/**
 * Factory: returns requireAuth middleware.
 * If getDB is provided, does a live ban check on every request.
 * Otherwise, trusts the JWT payload only (fast path).
 */
function makeRequireAuth(getDB) {
  return async function requireAuth(req, res, next) {
    try {
      const token = extractToken(req);

      // Allow internal service-to-service calls
      const apiKey = req.headers["x-internal-key"] || req.headers["x-api-key"];
      if (apiKey && apiKey === INTERNAL_API_KEY) {
        req.user = { grudge_id: "internal", role: "master", internal: true };
        return next();
      }

      if (!token) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      req.user = payload;

      // Live ban check if DB available
      if (getDB) {
        try {
          const db = typeof getDB === "function" ? getDB() : getDB;
          const [rows] = await db.execute(
            "SELECT is_banned, role FROM users WHERE grudge_id = ? LIMIT 1",
            [payload.grudge_id]
          );
          if (rows.length && rows[0].is_banned) {
            return res.status(403).json({ error: "Account suspended" });
          }
          if (rows.length) {
            req.user.role = rows[0].role;
          }
        } catch (_dbErr) {
          // DB error — fall through with JWT-only payload
        }
      }

      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" });
      }
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

/** Pre-built requireAuth (no DB ban check, JWT-only) */
const requireAuth = makeRequireAuth(null);

/** Require a minimum role level */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    const userLevel = ROLES[req.user.role] || 0;
    const minLevel = ROLES[minRole] || 0;
    if (userLevel < minLevel) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/** Internal service-to-service only */
function requireInternal(req, res, next) {
  const apiKey = req.headers["x-internal-key"] || req.headers["x-api-key"];
  if (apiKey && apiKey === INTERNAL_API_KEY) {
    req.user = { grudge_id: "internal", role: "master", internal: true };
    return next();
  }
  return res.status(403).json({ error: "Internal access only" });
}

/** Accept either valid JWT or internal key */
function requireAuthOrInternal(req, res, next) {
  const apiKey = req.headers["x-internal-key"] || req.headers["x-api-key"];
  if (apiKey && apiKey === INTERNAL_API_KEY) {
    req.user = { grudge_id: "internal", role: "master", internal: true };
    return next();
  }
  return requireAuth(req, res, next);
}

module.exports = {
  makeRequireAuth,
  requireAuth,
  requireRole,
  requireInternal,
  requireAuthOrInternal,
  isAdmin,
  isMaster,
  ROLES,
};
