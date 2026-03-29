'use strict';
function parseOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  const list = raw.split(',').map(o => o.trim()).filter(Boolean);
  return list.length ? list : null;
}
const METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const HEADERS = 'Content-Type,Authorization,X-Puter-UUID,X-Internal-Key,X-Requested-With';
function grudgeCors() {
  return function corsMiddleware(req, res, next) {
    const origins = parseOrigins();
    const requestOrigin = req.headers.origin;
    if (!origins) {
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
const DEFAULT_AUTH_REDIRECT = process.env.DEFAULT_AUTH_REDIRECT || 'https://grudgewarlords.com/auth';
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
      host === 'grudgeplatform.com' ||
      host === 'www.grudgeplatform.com' ||
      host === 'grudgeplatform.io' ||
      host === 'www.grudgeplatform.io' ||
      host.endsWith('.grudgeplatform.io') ||
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
module.exports = { grudgeCors, isAllowedRedirect, DEFAULT_AUTH_REDIRECT };
