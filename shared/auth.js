'use strict';

/**
 * shared/auth.js — Grudge Studio shared authentication & authorisation middleware
 *
 * Drop into any Express service:
 *
 *   const { makeRequireAuth, requireRole, requireInternal, isAdmin } = require('../../shared/auth');
 *   const requireAuth = makeRequireAuth(getDB);   // with live ban check
 *   const requireAuth = makeRequireAuth();         // JWT-only (no DB call)
 *
 *   router.get('/secure',           requireAuth,           handler);
 *   router.get('/admin-only',       ...isAdmin,            handler);
 *   router.get('/master-only',      ...isMaster,           handler);
 *   router.get('/internal-or-user', requireAuthOrInternal, handler);
 *   router.get('/internal-only',    requireInternal,       handler);
 *
 * Rule: NEVER trust grudge_id, role, or wallet address from req.body.
 *       Always derive user identity from the verified JWT via req.user.
 */

const ROLES = Object.freeze({ guest: 0, pleb: 1, member: 2, admin: 3, master: 4 });

// ── Core factory ─────────────────────────────────────────────────────────────

/**
 * Create a requireAuth middleware.
 *
 * @param {Function|null} getDb
 *   Optional: a zero-argument function that returns a MySQL2 pool (e.g. getDB from db.js).
 *   When provided, performs a live is_banned check on every request.
 *   When omitted, only the JWT payload is inspected for ban state.
 */
function makeRequireAuth(getDb) {
  return async function requireAuth(req, res, next) {
    // ── Internal service bypass (x-internal-key) ──────────────────────────
    if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
      req.isInternal = true;
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const jwt = require('jsonwebtoken');
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);

      // ── Consistent req.user shape across ALL services ─────────────────────
      req.user = {
        grudge_id: payload.grudge_id,
        username:  payload.username  || 'Player',
        role:      payload.role      || 'pleb',
        puter_id:  payload.puter_id  || null,
        is_guest:  payload.is_guest  || false,
      };

      // ── Live ban check (preferred — beats token propagation delay) ────────
      if (getDb) {
        const db = getDb();
        const [[row]] = await db.query(
          'SELECT is_banned, ban_reason FROM users WHERE grudge_id = ? LIMIT 1',
          [req.user.grudge_id]
        );
        if (row?.is_banned) {
          return res.status(403).json({ error: row.ban_reason || 'Account banned' });
        }
      } else if (payload.is_banned) {
        // Fallback: honour the ban flag embedded in the token itself
        return res.status(403).json({ error: 'Account banned' });
      }

      return next();
    } catch (err) {
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      return next(err);
    }
  };
}

// ── Role guard ───────────────────────────────────────────────────────────────

/**
 * requireRole(minRole)
 *
 * Must be placed AFTER requireAuth in the middleware chain.
 * Internal calls (x-internal-key) automatically bypass the role check.
 *
 * Example:
 *   router.delete('/ban/:id', requireAuth, requireRole('admin'), handler);
 */
function requireRole(minRole) {
  const minLevel = ROLES[minRole] ?? 0;
  return function requireRoleMiddleware(req, res, next) {
    if (req.isInternal) return next(); // service-to-service calls bypass roles
    const userLevel = ROLES[req.user?.role] ?? 0;
    if (userLevel < minLevel) {
      return res.status(403).json({
        error:     `Requires ${minRole} role or higher`,
        your_role: req.user?.role || 'none',
      });
    }
    return next();
  };
}

// ── Internal guard ───────────────────────────────────────────────────────────

/**
 * requireInternal
 *
 * Accepts ONLY service-to-service calls that carry the correct x-internal-key.
 * Use on routes that must never be reachable from the public internet.
 *
 * wallet-service uses this on every route.
 */
function requireInternal(req, res, next) {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden — internal endpoint' });
  }
  return next();
}

// ── Combination factories ────────────────────────────────────────────────────

/**
 * makeRequireAuthOrInternal(getDb?)
 *
 * Accepts a valid JWT OR a valid internal key.
 * Useful for endpoints called by both game-api and browser clients.
 */
function makeRequireAuthOrInternal(getDb) {
  const authFn = makeRequireAuth(getDb);
  return function requireAuthOrInternal(req, res, next) {
    if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
      req.isInternal = true;
      return next();
    }
    return authFn(req, res, next);
  };
}

// ── Pre-built variants (no live DB ban check) ─────────────────────────────────
// Use these when the service does not have direct MySQL access
// (e.g. lightweight services). For game-api and account-api, use
// makeRequireAuth(getDB) instead.

const requireAuth            = makeRequireAuth(null);
const requireAuthOrInternal  = makeRequireAuthOrInternal(null);

// ── Shorthand middleware arrays ───────────────────────────────────────────────
// Usage: router.delete('/admin/ban/:id', ...isAdmin, handler)

const isAdmin  = [requireAuth, requireRole('admin')];
const isMaster = [requireAuth, requireRole('master')];
const isMember = [requireAuth, requireRole('member')];

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Role map — import for comparisons: ROLES.admin > ROLES.pleb
  ROLES,

  // Factories (pass getDB for live ban checks)
  makeRequireAuth,
  makeRequireAuthOrInternal,

  // Pre-built (JWT-only, no DB)
  requireAuth,
  requireAuthOrInternal,

  // Single-use guards
  requireInternal,
  requireRole,

  // Shorthand arrays for common role requirements
  isAdmin,
  isMaster,
  isMember,
};
