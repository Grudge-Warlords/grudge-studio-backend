'use strict';

/**
 * shared/cors.js — Grudge Studio shared CORS helpers
 *
 * Reads comma-separated origins from CORS_ORIGINS env var.
 * Used by all externally-exposed Express services.
 */

function parseOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  const list = raw.split(',').map(o => o.trim()).filter(Boolean);
  if (list.length) return list;
  // In production, require explicit CORS_ORIGINS to be set
  if (process.env.NODE_ENV === 'production') {
    console.warn('[cors] WARNING: CORS_ORIGINS not set in production — denying cross-origin requests');
    return [];
  }
  return null; // dev: allow all
}

const METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const HEADERS = 'Content-Type,Authorization,X-Puter-UUID,X-Internal-Key,X-Requested-With';

/**
 * Returns an Express CORS middleware configured from CORS_ORIGINS env var.
 * Supports credentials (cookies / Authorization headers).
 */
function grudgeCors() {
  return function corsMiddleware(req, res, next) {
    const origins = parseOrigins();
    const requestOrigin = req.headers.origin;

    if (origins === null) {
      // Dev: allow all
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    } else if (origins.length > 0 && requestOrigin && origins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    // else: no CORS headers set — browser will block cross-origin requests

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', METHODS);
    res.setHeader('Access-Control-Allow-Headers', HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  };
}

/**
 * Returns a CORS config object suitable for Socket.IO / ws-service.
 */
function grudgeCorsConfig() {
  const origins = parseOrigins();
  return {
    origin: origins === null ? '*' : (origins.length ? origins : false),
    credentials: true,
    methods: ['GET', 'POST'],
  };
}

/**
 * Default redirect URL after OAuth login (used by grudge-id auth routes).
 */
const DEFAULT_AUTH_REDIRECT = process.env.DEFAULT_AUTH_REDIRECT || 'https://grudgewarlords.com/auth';

/**
 * Validate that a redirect_uri is one of our trusted destinations.
 * Accepts any subdomain of grudge-studio.com, grudgewarlords.com,
 * *.vercel.app (GrudgeNexus org), puter.com/puter.site, and GitHub Pages.
 */
function isAllowedRedirect(uri) {
  if (!uri) return false;
  try {
    const u = new URL(uri);
    const host = u.hostname;
    return (
      host === 'grudgewarlords.com' ||
      host === 'www.grudgewarlords.com' ||
      host.endsWith('.grudge-studio.com') ||
      host === 'grudge-studio.com' ||
      host === 'grudgestudio.com' ||
      host.endsWith('.grudgestudio.com') ||
      host.endsWith('.vercel.app') ||
      host.endsWith('.puter.site') ||
      host === 'app.puter.com' ||
      host === 'molochdagod.github.io' ||
      host === 'localhost'
    );
  } catch {
    return false;
  }
}

module.exports = { grudgeCors, grudgeCorsConfig, isAllowedRedirect, DEFAULT_AUTH_REDIRECT };
