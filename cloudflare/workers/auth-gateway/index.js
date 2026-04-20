/**
 * Grudge Studio — Auth Gateway Worker  v1.0
 *
 * Edge auth proxy for auth.grudgestudio.com
 * Proxies all auth requests to id.grudge-studio.com (VPS)
 * with KV-backed session caching, rate limiting, and ban enforcement.
 *
 * KV Key Schema:
 *   auth:session:{sha256}  → cached user payload   (TTL: 300s)
 *   auth:rl:{ip}           → rate limit counter     (TTL: 60s)
 *   auth:ban:{grudge_id}   → banned user flag       (no TTL)
 *
 * Deploy:  npx wrangler deploy  (from cloudflare/workers/auth-gateway/)
 * Secret:  npx wrangler secret put AUTH_INTERNAL_KEY
 */

// ── Config ───────────────────────────────────────────────────────────────────
const SESSION_CACHE_TTL = 300;   // 5 minutes
const RATE_LIMIT_MAX    = 20;    // requests per window
const RATE_LIMIT_WINDOW = 60;    // seconds
const PROXY_TIMEOUT     = 10000; // 10s

// Auth routes that create/return tokens — responses get cached in KV
const TOKEN_ROUTES = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/guest',
  '/auth/wallet',
  '/auth/puter',
  '/auth/puter-bridge',
  '/auth/discord/exchange',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/guest',
  '/api/auth/web3auth',
]);

// Routes that need rate limiting (sensitive auth actions)
const RATE_LIMITED_ROUTES = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/wallet',
  '/auth/guest',
]);

// ── CORS allowlist (mirrors r2-cdn worker) ───────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://grudgewarlords.com',
  'https://www.grudgewarlords.com',
  'https://grudge-studio.com',
  'https://grudgestudio.com',
  'https://grudgeplatform.com',
  'https://www.grudgeplatform.com',
  'https://grudgeplatform.io',
  'https://www.grudgeplatform.io',
  'https://play.grudgeplatform.io',
  'https://grudachain.grudgestudio.com',
  'https://dash.grudge-studio.com',
  'https://auth.grudgestudio.com',
  'https://launcher.grudge-studio.com',
  'https://app.grudge-studio.com',
  'https://grudge-platform.vercel.app',
  'https://grudachain-rho.vercel.app',
  'https://warlord-crafting-suite.vercel.app',
  'https://gdevelop-assistant.vercel.app',
  'https://gruda-wars.vercel.app',
  'https://grudge-engine-web.vercel.app',
  'https://starwaygruda-webclient-as2n.vercel.app',
  'https://app.puter.com',
  'https://molochdagod.github.io',
  'https://nemesis-grudge-qu02egpmh-grudgenexus.vercel.app',
  'https://nemesis.grudge-studio.com',
  'https://grudge-pipeline.vercel.app',
  'https://id.grudge-studio.com',
  'https://info.grudge-studio.com',
]);

// ── Security headers ─────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
};

// ── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const path   = url.pathname;
    const origin = request.headers.get('Origin') ?? '';

    // ── CORS preflight ─────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return corsResponse(origin);
    }

    // ── Health check (no proxy) ────────────────────────────────────────────
    if (path === '/health') {
      return json({
        status:  'ok',
        service: 'auth-gateway',
        edge:    request.cf?.colo || 'unknown',
        ts:      Date.now(),
      }, 200, origin);
    }

    // ── Rate limiting on sensitive endpoints ────────────────────────────────
    if (RATE_LIMITED_ROUTES.has(path) && method === 'POST') {
      const blocked = await checkRateLimit(env, request);
      if (blocked) {
        return json(
          { error: 'Too many requests', retryAfter: RATE_LIMIT_WINDOW },
          429,
          origin,
          { 'Retry-After': String(RATE_LIMIT_WINDOW) }
        );
      }
    }

    // ── POST /auth/verify — KV-first, then proxy ──────────────────────────
    if (path === '/auth/verify' && method === 'POST') {
      return handleVerify(request, env, ctx, origin);
    }

    // ── GET /auth/session — fast edge session check ────────────────────────
    if (path === '/auth/session' && method === 'GET') {
      return handleSessionCheck(request, env, origin);
    }

    // ── POST /auth/logout — invalidate KV session ─────────────────────────
    if (path === '/auth/logout' && method === 'POST') {
      return handleLogout(request, env, origin);
    }

    // ── Token-issuing routes — proxy + cache ──────────────────────────────
    if (TOKEN_ROUTES.has(path) && method === 'POST') {
      return proxyAndCache(request, env, ctx, path, origin);
    }

    // ── Platform compat /api/auth/* routes ─────────────────────────
    if (path.startsWith('/api/auth/')) {
      if (TOKEN_ROUTES.has(path) && method === 'POST') {
        return proxyAndCache(request, env, ctx, path, origin);
      }
      return proxyPassthrough(request, env, path, origin);
    }

    // ── Static auth page + SDK ──────────────────────────────────
    if (path === '/auth' || path === '/auth/' || path.startsWith('/auth/grudge-auth-redirect')) {
      return proxyPassthrough(request, env, path, origin);
    }

    // ── Pass-through routes (discord redirect, puter-link, etc.) ────────────
    if (path.startsWith('/auth/')) {
      return proxyPassthrough(request, env, path, origin);
    }

    // ── Device pairing API + HTML pages ───────────────────────────────
    if (path.startsWith('/device') || path === '/account') {
      return proxyPassthrough(request, env, path, origin);
    }

    // ── 404 ───────────────────────────────────────────────────────
    return json({ error: 'Not Found' }, 404, origin);
  },
};

// ── POST /auth/verify ─────────────────────────────────────────────────────────
// Check KV cache first (avoids VPS round-trip), fall back to VPS verify
async function handleVerify(request, env, ctx, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin);
  }

  const { token } = body;
  if (!token) {
    return json({ error: 'token required' }, 400, origin);
  }

  // Check KV cache
  if (env.KV) {
    const hash = await sha256(token);
    const cached = await env.KV.get(`auth:session:${hash}`);
    if (cached) {
      const payload = JSON.parse(cached);

      // Check ban list
      if (payload.grudge_id) {
        const banned = await env.KV.get(`auth:ban:${payload.grudge_id}`);
        if (banned) {
          return json({ valid: false, error: 'Account banned' }, 403, origin);
        }
      }

      return json({ valid: true, payload, cached: true, edge: true }, 200, origin);
    }
  }

  // Cache miss — proxy to VPS
  const idApi = env.IDENTITY_API || 'https://id.grudge-studio.com';
  try {
    const resp = await fetch(`${idApi}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(PROXY_TIMEOUT),
    });

    const data = await resp.json();

    // Cache valid sessions
    if (resp.ok && data.valid && data.payload && env.KV) {
      const hash = await sha256(token);
      ctx.waitUntil(
        env.KV.put(`auth:session:${hash}`, JSON.stringify(data.payload), {
          expirationTtl: SESSION_CACHE_TTL,
        })
      );
    }

    return json({ ...data, cached: false, edge: true }, resp.status, origin);
  } catch (e) {
    return json({ error: 'Identity service unavailable', detail: e.message }, 502, origin);
  }
}

// ── GET /auth/session ─────────────────────────────────────────────────────────
// Fast edge check — extracts token from Authorization header, looks up KV
async function handleSessionCheck(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Authorization header required' }, 401, origin);
  }

  const token = authHeader.substring(7);
  if (!token) {
    return json({ error: 'Token required' }, 401, origin);
  }

  if (!env.KV) {
    return json({ error: 'Session store unavailable' }, 503, origin);
  }

  const hash = await sha256(token);
  const cached = await env.KV.get(`auth:session:${hash}`);

  if (!cached) {
    // Not in KV — could be valid but not cached; tell client to re-verify
    return json({ valid: false, reason: 'session_expired_or_not_cached' }, 401, origin);
  }

  const payload = JSON.parse(cached);

  // Ban check
  if (payload.grudge_id) {
    const banned = await env.KV.get(`auth:ban:${payload.grudge_id}`);
    if (banned) {
      // Purge cached session for banned user
      await env.KV.delete(`auth:session:${hash}`);
      return json({ valid: false, error: 'Account banned' }, 403, origin);
    }
  }

  return json({ valid: true, user: payload, cached: true }, 200, origin);
}

// ── POST /auth/logout ─────────────────────────────────────────────────────────
async function handleLogout(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ') && env.KV) {
    const token = authHeader.substring(7);
    const hash = await sha256(token);
    await env.KV.delete(`auth:session:${hash}`);
  }

  // Also proxy to VPS in case it has server-side session logic
  const idApi = env.IDENTITY_API || 'https://id.grudge-studio.com';
  try {
    await fetch(`${idApi}/auth/logout`, {
      method: 'POST',
      headers: forwardHeaders(request),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // VPS logout is best-effort
  }

  return json({ success: true, message: 'Session invalidated' }, 200, origin);
}

// ── Proxy + cache token response ──────────────────────────────────────────────
async function proxyAndCache(request, env, ctx, path, origin) {
  const idApi = env.IDENTITY_API || 'https://id.grudge-studio.com';

  let body;
  try {
    body = await request.text();
  } catch {
    return json({ error: 'Invalid request body' }, 400, origin);
  }

  try {
    const resp = await fetch(`${idApi}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type':   request.headers.get('Content-Type') || 'application/json',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
        'X-Request-ID':    crypto.randomUUID(),
        ...(env.AUTH_INTERNAL_KEY ? { 'x-internal-key': env.AUTH_INTERNAL_KEY } : {}),
      },
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT),
    });

    const data = await resp.json();

    // On successful auth — cache session in KV
    if (resp.ok && data.token && env.KV) {
      const hash = await sha256(data.token);
      const sessionPayload = data.user || data.payload || {
        grudge_id: data.grudgeId || data.grudge_id,
        username:  data.username,
      };

      ctx.waitUntil(
        env.KV.put(`auth:session:${hash}`, JSON.stringify(sessionPayload), {
          expirationTtl: SESSION_CACHE_TTL,
        })
      );
    }

    return json(data, resp.status, origin);
  } catch (e) {
    return json({ error: 'Identity service unavailable', detail: e.message }, 502, origin);
  }
}

// ── Pass-through proxy (no caching) ───────────────────────────────────────────
async function proxyPassthrough(request, env, path, origin) {
  const idApi = env.IDENTITY_API || 'https://id.grudge-studio.com';

  try {
    const resp = await fetch(`${idApi}${path}`, {
      method:  request.method,
      headers: forwardHeaders(request),
      body:    request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual', // preserve redirects (e.g. Discord OAuth)
      signal:   AbortSignal.timeout(PROXY_TIMEOUT),
    });

    // For redirects, pass through with CORS headers
    if (resp.status >= 300 && resp.status < 400) {
      const headers = new Headers(resp.headers);
      applyCORS(headers, origin);
      applySecurityHeaders(headers);
      return new Response(null, { status: resp.status, headers });
    }

    // JSON response
    const contentType = resp.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      return json(data, resp.status, origin);
    }

    // Other responses (HTML, etc.)
    const headers = new Headers(resp.headers);
    applyCORS(headers, origin);
    applySecurityHeaders(headers);
    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    return json({ error: 'Identity service unavailable', detail: e.message }, 502, origin);
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
async function checkRateLimit(env, request) {
  if (!env.KV) return false;

  const ip  = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = `auth:rl:${ip}`;
  const cur = await env.KV.get(key);
  const count = cur ? parseInt(cur, 10) : 0;

  if (count >= RATE_LIMIT_MAX) return true;

  // Increment in background
  await env.KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return false;
}

// ── SHA-256 helper ────────────────────────────────────────────────────────────
async function sha256(text) {
  const data   = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Forward request headers to VPS ────────────────────────────────────────────
function forwardHeaders(request) {
  return {
    'Content-Type':    request.headers.get('Content-Type') || 'application/json',
    'Authorization':   request.headers.get('Authorization') || '',
    'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
    'X-Request-ID':    crypto.randomUUID(),
  };
}

// ── CORS helpers ──────────────────────────────────────────────────────────────
function corsResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.has(origin) ? origin : 'https://grudgestudio.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
      'Access-Control-Max-Age':       '86400',
    },
  });
}

function applyCORS(headers, origin) {
  headers.set(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.has(origin) ? origin : 'https://grudgestudio.com'
  );
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  headers.set('Access-Control-Expose-Headers', 'X-Request-ID');
}

function applySecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
}

// ── JSON response helper ──────────────────────────────────────────────────────
function json(data, status = 200, origin = '', extra = {}) {
  const headers = new Headers({
    'Content-Type':  'application/json',
    'Cache-Control': 'no-store',
    ...extra,
  });
  applyCORS(headers, origin);
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
