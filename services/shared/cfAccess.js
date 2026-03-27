/**
 * Cloudflare Access JWT Middleware
 *
 * Validates the `Cf-Access-Jwt-Assertion` header that Cloudflare Access
 * injects on every authenticated request before forwarding to the origin.
 *
 * Required env vars (per service):
 *   CF_TEAM_DOMAIN   – e.g. https://grudge-studio.cloudflareaccess.com
 *   CF_ACCESS_AUD    – Application Audience tag from the Access app settings
 *
 * If CF_TEAM_DOMAIN is not set the middleware is a PASSTHROUGH so existing
 * auth flows are not broken before Access is configured.
 *
 * Routes that are always bypassed (no CF token required):
 *   - /health
 *   - /.well-known/*  (ACME challenges, Vercel verification)
 *
 * Usage:
 *   const { cfAccessRequired, cfAccessOptional } = require('../../shared/cfAccess');
 *   app.use('/identity', cfAccessOptional, identityRoutes);   // attach email to req.cfUser
 *   app.use('/admin',    cfAccessRequired, adminRoutes);      // 403 if not CF-Access authenticated
 */

const https = require('https');
const jwt   = require('jsonwebtoken');

// ── JWKS cache ───────────────────────────────────────────────────────────────
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // refresh every 10 minutes
let _jwksCache = null;
let _jwksCacheAt = 0;

/**
 * Fetch and cache the Cloudflare Access public keys (JWKS).
 * Uses kid-indexed Map for fast lookup.
 */
async function getJWKS(teamDomain) {
  const now = Date.now();
  if (_jwksCache && now - _jwksCacheAt < JWKS_CACHE_TTL_MS) return _jwksCache;

  const url = `${teamDomain}/cdn-cgi/access/certs`;
  const raw = await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  const parsed = JSON.parse(raw);
  // Build a Map: kid → PEM cert string
  const keys = new Map();
  for (const cert of (parsed.public_certs || [])) {
    keys.set(cert.kid, cert.cert);
  }

  _jwksCache = keys;
  _jwksCacheAt = now;
  return keys;
}

// ── Core validation ───────────────────────────────────────────────────────────
async function validateCFToken(token, teamDomain, aud) {
  if (!token) return null;

  // Decode header to get kid without verifying first
  let header;
  try {
    const parts = token.split('.');
    header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
  } catch {
    return null;
  }

  const keys = await getJWKS(teamDomain);
  const cert = keys.get(header.kid);
  if (!cert) {
    // Key not found; try refreshing once
    _jwksCache = null;
    const fresh = await getJWKS(teamDomain);
    const c2 = fresh.get(header.kid);
    if (!c2) return null;
    return verifyToken(token, c2, teamDomain, aud);
  }
  return verifyToken(token, cert, teamDomain, aud);
}

function verifyToken(token, cert, teamDomain, aud) {
  return new Promise((resolve) => {
    jwt.verify(token, cert, {
      algorithms: ['RS256'],
      issuer: teamDomain,
      audience: aud,
    }, (err, decoded) => {
      if (err) { resolve(null); return; }
      resolve(decoded);
    });
  });
}

// ── Bypass paths ──────────────────────────────────────────────────────────────
function isBypassPath(path) {
  return path === '/health' || path.startsWith('/.well-known/');
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Optional: attaches `req.cfUser` if a valid CF Access token is present.
 * Never blocks the request.
 */
function cfAccessOptional(req, res, next) {
  const teamDomain = process.env.CF_TEAM_DOMAIN;
  const aud        = process.env.CF_ACCESS_AUD;
  if (!teamDomain || !aud || isBypassPath(req.path)) return next();

  const token = req.headers['cf-access-jwt-assertion'];
  if (!token) return next();

  validateCFToken(token, teamDomain, aud)
    .then(decoded => {
      if (decoded) req.cfUser = { email: decoded.email, sub: decoded.sub };
      next();
    })
    .catch(() => next());
}

/**
 * Required: returns 403 if no valid CF Access token.
 * Use this on admin/internal routes that should only be reachable
 * through Cloudflare Access (never directly from the public internet).
 */
function cfAccessRequired(req, res, next) {
  const teamDomain = process.env.CF_TEAM_DOMAIN;
  const aud        = process.env.CF_ACCESS_AUD;

  // Passthrough if CF Access is not configured (dev mode)
  if (!teamDomain || !aud) return next();
  if (isBypassPath(req.path)) return next();

  const token = req.headers['cf-access-jwt-assertion'];
  if (!token) {
    return res.status(403).json({
      error: 'Forbidden',
      hint: 'Access token required. Reach this service through Cloudflare Access.',
    });
  }

  validateCFToken(token, teamDomain, aud)
    .then(decoded => {
      if (!decoded) {
        return res.status(403).json({ error: 'Invalid or expired Access token' });
      }
      req.cfUser = { email: decoded.email, sub: decoded.sub };
      next();
    })
    .catch(err => {
      console.error('[cfAccess] Validation error:', err.message);
      res.status(403).json({ error: 'Access token validation failed' });
    });
}

module.exports = { cfAccessOptional, cfAccessRequired };
