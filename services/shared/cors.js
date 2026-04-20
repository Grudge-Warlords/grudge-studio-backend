/**
 * Grudge Studio — Shared CORS & Redirect Validation
 *
 * Single source of truth for allowed origins across ALL backend services.
 * Any *.grudge-studio.com, *.grudgestudio.com, *.grudgewarlords.com subdomain
 * is allowed, plus Grudge Vercel deploys, Puter apps, and localhost in dev.
 *
 * Usage:
 *   const { grudgeCors, isAllowedOrigin, isAllowedRedirect } = require('../../shared/cors');
 *   app.use(grudgeCors());
 */

const cors = require('cors');

// ── Grudge domain patterns ───────────────────────────────────────────────────
// These match any subdomain (including bare domain) for each Grudge property.
const GRUDGE_DOMAIN_PATTERNS = [
  /^https?:\/\/([a-z0-9-]+\.)?grudge-studio\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgestudio\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgewarlords\.com$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgeplatform\.io$/,
  /^https?:\/\/([a-z0-9-]+\.)?grudgeplatform\.com$/,
];

// Vercel preview/production deploys for known Grudge projects
const GRUDGE_VERCEL_PREFIXES = [
  'grudge-',
  'dungeon-crawler',
  'gdevelop-assistant',
  'warlord-',
  'grudachain',
  'gruda-',
  'thc-labz',
  'dope-budz',
];

// Matches: https://{prefix}*.vercel.app
const VERCEL_PATTERN = /^https:\/\/([a-z0-9-]+)\.vercel\.app$/;

// Puter-hosted apps
const PUTER_PATTERN = /^https:\/\/[a-z0-9-]+\.puter\.site$/;

// Cloudflare Workers preview URLs — *.grudge.workers.dev and preview variants
const CF_WORKERS_PATTERN = /^https:\/\/[a-z0-9-]+\.grudge\.workers\.dev$/;

// Localhost (dev only)
const LOCALHOST_PATTERN = /^https?:\/\/localhost(:\d+)?$/;

// ── Extra origins from env (comma-separated) ─────────────────────────────────
function getExtraOrigins() {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

// ── Origin validation ────────────────────────────────────────────────────────

/**
 * Check if an origin is allowed for CORS.
 * @param {string} origin — The Origin header value
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // server-to-server (no Origin header)

  // Grudge domains (any subdomain)
  for (const pattern of GRUDGE_DOMAIN_PATTERNS) {
    if (pattern.test(origin)) return true;
  }

  // Puter apps
  if (PUTER_PATTERN.test(origin)) return true;

  // Cloudflare Workers preview deployments (*.grudge.workers.dev)
  if (CF_WORKERS_PATTERN.test(origin)) return true;

  // Vercel — only Grudge project deploys
  const vercelMatch = origin.match(VERCEL_PATTERN);
  if (vercelMatch) {
    const subdomain = vercelMatch[1].toLowerCase();
    if (GRUDGE_VERCEL_PREFIXES.some(prefix => subdomain.startsWith(prefix))) {
      return true;
    }
  }

  // Localhost in development
  if (process.env.NODE_ENV !== 'production' && LOCALHOST_PATTERN.test(origin)) {
    return true;
  }

  // Explicit allow-list from CORS_ORIGINS env
  if (getExtraOrigins().includes(origin)) return true;

  return false;
}

/**
 * Validate a redirect_uri for OAuth callbacks.
 * Stricter than CORS — must be HTTPS in production and match a Grudge domain.
 * @param {string} uri — The full redirect URI
 * @returns {boolean}
 */
function isAllowedRedirect(uri) {
  if (!uri) return false;

  try {
    const parsed = new URL(uri);

    // Must be HTTPS in production
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      return false;
    }

    // Use origin check (strips path)
    const origin = parsed.origin;
    return isAllowedOrigin(origin);
  } catch {
    return false;
  }
}

// ── Default fallback redirect ────────────────────────────────────────────────
const DEFAULT_AUTH_REDIRECT = process.env.DEFAULT_AUTH_REDIRECT || 'https://grudgewarlords.com';

// ── Express CORS middleware factory ──────────────────────────────────────────

/**
 * Returns a configured cors() middleware using Grudge domain validation.
 * Drop-in replacement for the per-service CORS setup.
 *
 * @param {object} [opts] — Extra options to merge into cors config
 * @returns Express middleware
 */
function grudgeCors(opts = {}) {
  return cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
    ...opts,
  });
}

/**
 * Socket.IO-compatible CORS config object.
 * Usage: new Server(httpServer, { cors: grudgeCorsConfig() })
 */
function grudgeCorsConfig() {
  return {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  };
}

module.exports = {
  grudgeCors,
  grudgeCorsConfig,
  isAllowedOrigin,
  isAllowedRedirect,
  DEFAULT_AUTH_REDIRECT,
};
