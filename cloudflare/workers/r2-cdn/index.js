/**
 * Grudge Studio — R2 CDN Worker
 *
 * Free Cloudflare services used:
 *  ✅ Workers        — 100 K req/day free, no expiry
 *  ✅ R2 binding     — native, zero egress fees (no S3 API call needed)
 *  ✅ Cache API      — edge cache, drastically reduces R2 Class B reads
 *  ✅ Workers KV     — per-IP rate limiting to prevent scraping / abuse
 *
 * Deploy  : npx wrangler deploy  (from cloudflare/workers/r2-cdn/)
 * Domain  : assets.grudgestudio.com  (CNAME → this Worker after deploy)
 * Bucket  : grudge-assets
 *
 * URL scheme:
 *   https://assets.grudgestudio.com/avatars/<grudge_id>/<hash>.webp
 *   https://assets.grudgestudio.com/game-assets/<path>
 *   https://assets.grudgestudio.com/manifests/latest.json   (mutable)
 *   https://assets.grudgestudio.com/versions/<ver>.json     (mutable)
 */

// ─── Cache TTLs ──────────────────────────────────────────────────────────────
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';          // 1 yr
const CACHE_MUTABLE   = 'public, max-age=300, s-maxage=60, must-revalidate'; // 5 min

// Paths that can change between game updates — use short cache
const MUTABLE_PREFIXES = ['manifests/', 'versions/', 'config/', 'patches/', 'game-data/'];

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const RL_MAX    = 120; // requests allowed per IP per window
const RL_WINDOW = 60;  // seconds

// ─── Allowed CORS origins ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://grudgewarlords.com',
  'https://grudgestudio.com',
  'https://grudachain.grudgestudio.com',
  'https://launcher.grudgestudio.com',
  // grudge-studio.com (hyphenated domain)
  'https://grudge-studio.com',
  'https://assets.grudge-studio.com',
  'https://app.grudge-studio.com',
  'https://launcher.grudge-studio.com',
]);

// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const origin = request.headers.get('Origin') ?? '';

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return corsPreflightResponse(origin);
    }

    // ── Health check — used by dash.grudge-studio.com ─────────────────────────
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status:  'ok',
        service: 'r2-cdn',
        bucket:  'grudge-assets',
        ts:      Date.now(),
      }), {
        headers: {
          'Content-Type':  'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Read-only CDN — reject mutations
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ── Decode R2 key from path ───────────────────────────────────────────────
    const key = decodeURIComponent(url.pathname.slice(1)); // strip leading /
    if (!key) {
    return new Response('Grudge Studio CDN — assets.grudge-studio.com\n', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // ── KV Rate Limiting (per IP) ─────────────────────────────────────────────
    // RATE_LIMIT KV namespace binds to this Worker via wrangler.toml.
    // Free tier: 100K reads + 1K writes/day — only applied when the key is absent
    // (cache miss path), so production reads are cheap.
    if (env.RATE_LIMIT) {
      const ip    = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const rlKey = `rl:${ip}`;

      const cur   = await env.RATE_LIMIT.get(rlKey);
      const count = cur ? parseInt(cur, 10) : 0;

      if (count >= RL_MAX) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': String(RL_WINDOW) },
        });
      }

      // Increment in background — don't delay response
      ctx.waitUntil(
        env.RATE_LIMIT.put(rlKey, String(count + 1), { expirationTtl: RL_WINDOW })
      );
    }

    // ── Cloudflare Cache API ──────────────────────────────────────────────────
    // Caches the full response at the edge — subsequent hits skip R2 entirely,
    // saving R2 Class B reads (free tier: 10M/month).
    const cache    = caches.default;
    const cacheKey = new Request(url.toString());
    const cached   = await cache.match(cacheKey);

    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('CF-Cache-Status', 'HIT');
      applyCORS(hit.headers, origin);
      return hit;
    }

    // ── Conditional request support (ETag / If-Modified-Since) ───────────────
    const r2Opts = {};
    const ifNoneMatch    = request.headers.get('If-None-Match');
    const ifModifiedSince = request.headers.get('If-Modified-Since');

    if (ifNoneMatch || ifModifiedSince) {
      r2Opts.onlyIf = {
        ...(ifNoneMatch     ? { etagMatches: ifNoneMatch }                       : {}),
        ...(ifModifiedSince ? { uploadedBefore: new Date(ifModifiedSince) }      : {}),
      };
    }

    // ── Fetch from R2 via native binding (no HTTP, no egress cost) ───────────
    const object = await env.GRUDGE_ASSETS.get(key, r2Opts);

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    // 304 Not Modified (conditional request matched)
    if (!object.body) {
      return new Response(null, { status: 304 });
    }

    // ── Build response headers ────────────────────────────────────────────────
    const headers = new Headers();
    object.writeHttpMetadata(headers); // copies ContentType, ContentEncoding etc.
    headers.set('ETag',          object.httpEtag);
    headers.set('Last-Modified', object.uploaded.toUTCString());
    headers.set('Accept-Ranges', 'bytes');

    // Security (best-practice for Cloudflare Always Use HTTPS + TLS 1.3 zone)
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    headers.set('X-Content-Type-Options',    'nosniff');
    headers.set('X-Frame-Options',           'DENY');
    headers.set('Referrer-Policy',           'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy',        'interest-cohort=()');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin'); // allow CDN embeds

    // Cache-Control
    const isMutable = MUTABLE_PREFIXES.some(p => key.startsWith(p));
    headers.set('Cache-Control', isMutable ? CACHE_MUTABLE : CACHE_IMMUTABLE);
    headers.set('CF-Cache-Status', 'MISS');
    headers.set('Vary', 'Accept, Accept-Encoding');

    applyCORS(headers, origin);

    const response = new Response(object.body, { status: 200, headers });

    // Store in Cache API so next request is a HIT (fire-and-forget)
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};

// ─── CORS helpers ─────────────────────────────────────────────────────────────
function corsPreflightResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.has(origin) ? origin : 'https://grudgestudio.com',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Max-Age':       '86400',
    },
  });
}

function applyCORS(headers, origin) {
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.has(origin) ? origin : '*');
  headers.append('Vary', 'Origin');
}
