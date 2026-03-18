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
  return list.length ? list : null; // null = allow all
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

    if (!origins) {
      // Dev: allow all
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    } else if (requestOrigin && origins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }

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
    origin: origins || '*',
    credentials: true,
    methods: ['GET', 'POST'],
  };
}

module.exports = { grudgeCors, grudgeCorsConfig };
