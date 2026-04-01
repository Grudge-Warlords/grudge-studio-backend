/**
 * account-api/src/middleware/auth.js
 *
 * Re-exports from shared/auth.js — single source of truth for all services.
 * For a live DB ban check, use: makeRequireAuth(getDB) from shared/auth.
 * The pre-built exports below use JWT-payload-only validation (fast, no DB call).
 */
const {
  makeRequireAuth,
  requireAuth,
  requireRole,
  requireInternal,
  requireAuthOrInternal,
  isAdmin,
  isMaster,
  ROLES,
} = require('../../../shared/auth');

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
