/**
 * Grudge Studio — Unified R2 ObjectStore Worker
 *
 * Serves two roles from one Worker:
 *   1. CDN   (assets.grudge-studio.com)  — fast cached reads for game clients
 *   2. API   (objectstore.grudge-studio.com) — full CRUD for studio tools
 *
 * Free Cloudflare services:
 *   Workers (100K req/day), R2 (zero egress), Cache API, Workers KV
 *
 * Deploy:  npx wrangler deploy  (from cloudflare/workers/r2-cdn/)
 * Bucket:  grudge-assets
 */

// ─── Cache TTLs ──────────────────────────────────────────────────────────────
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';          // 1 yr
const CACHE_MUTABLE   = 'public, max-age=300, s-maxage=60, must-revalidate'; // 5 min

// Paths that can change between game updates — use short cache
const MUTABLE_PREFIXES = ['manifests/', 'versions/', 'config/', 'patches/', 'game-data/'];

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const RL_READ_MAX  = 200;
const RL_WRITE_MAX = 30;
const RL_WINDOW    = 60;

// ─── Allowed CORS origins ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://grudgewarlords.com',
  'https://grudgestudio.com',
  'https://grudachain.grudgestudio.com',
  'https://launcher.grudgestudio.com',
  'https://grudge-studio.com',
  'https://assets.grudge-studio.com',
  'https://objectstore.grudge-studio.com',
  'https://assets-api.grudge-studio.com',
  'https://app.grudge-studio.com',
  'https://dash.grudge-studio.com',
  'https://lab.grudge-studio.com',
  'https://id.grudge-studio.com',
  'https://api.grudge-studio.com',
  'https://objectstore.vercel.app',
  'https://grudge-ai-lab.vercel.app',
  'https://molochdagod.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8787',
]);
// Also allow *.puter.site and *.vercel.app subdomains
const DYNAMIC_ORIGIN_RE = /\.(puter\.site|vercel\.app)$/;

// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const origin = request.headers.get('Origin') ?? '';
    const path   = url.pathname;

    // ── CORS preflight ──────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return corsResponse(origin, 204, null, {
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
        'Access-Control-Max-Age': '86400',
      });
    }

    // ── Route: /v1/* = ObjectStore API ───────────────────────────────────
    if (path.startsWith('/v1/')) {
      return handleAPI(request, env, ctx, url, method, origin);
    }

    // ── Route: /health (legacy CDN health) ──────────────────────────────
    if (path === '/health') {
      return jsonResponse({
        status: 'ok', service: 'grudge-objectstore',
        bucket: 'grudge-assets', ts: Date.now(),
      }, origin);
    }

    // ── Route: everything else = CDN read ───────────────────────────────
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    return handleCDNRead(request, env, ctx, url, origin);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
//  API HANDLER — /v1/*
// ═════════════════════════════════════════════════════════════════════════════

async function handleAPI(request, env, ctx, url, method, origin) {
  const path = url.pathname;

  // ── /v1/health ────────────────────────────────────────────────────────
  if (path === '/v1/health') {
    let r2ok = true;
    try { await env.GRUDGE_ASSETS.head('__health__'); } catch { r2ok = false; }
    return jsonResponse({
      status: 'ok', service: 'grudge-objectstore', version: '2.0.0',
      bucket: 'grudge-assets', r2: r2ok ? 'connected' : 'error', ts: Date.now(),
    }, origin);
  }

  // ── /v1/assets — LIST or UPLOAD ───────────────────────────────────────
  if (path === '/v1/assets') {
    if (method === 'GET') return handleListAssets(env, url, origin);
    if (method === 'POST') return handleUploadAsset(request, env, ctx, origin);
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── /v1/assets/:key/file — DOWNLOAD via CDN ──────────────────────────
  const fileMatch = path.match(/^\/v1\/assets\/(.+)\/file$/);
  if (fileMatch && (method === 'GET' || method === 'HEAD')) {
    const key = decodeURIComponent(fileMatch[1]);
    return handleCDNRead(request, env, ctx, new URL(`/${key}`, url.origin), origin);
  }

  // ── /v1/assets/:key — META / PUT / DELETE ─────────────────────────────
  const assetMatch = path.match(/^\/v1\/assets\/(.+)$/);
  if (assetMatch) {
    const key = decodeURIComponent(assetMatch[1]);
    if (method === 'GET' || method === 'HEAD') return handleGetAssetMeta(env, key, origin);
    if (method === 'PUT') return handlePutAsset(request, env, key, origin);
    if (method === 'DELETE') return handleDeleteAsset(env, key, origin);
    return new Response('Method Not Allowed', { status: 405 });
  }

  return new Response('Not Found', { status: 404 });
}

// ── LIST assets ─────────────────────────────────────────────────────────────
async function handleListAssets(env, url, origin) {
  const prefix   = url.searchParams.get('prefix') || '';
  const limit    = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 1000);
  const cursor   = url.searchParams.get('cursor') || undefined;
  const category = url.searchParams.get('category') || '';

  const listOpts = { limit, prefix };
  if (cursor) listOpts.cursor = cursor;

  const listed = await env.GRUDGE_ASSETS.list(listOpts);

  const assets = listed.objects.map(obj => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded?.toISOString() || null,
    etag: obj.httpEtag || null,
    category: obj.customMetadata?.category || detectCategory(obj.key),
    tags: safeParse(obj.customMetadata?.tags),
    contentType: obj.httpMetadata?.contentType || null,
  }));

  const filtered = category
    ? assets.filter(a => a.category === category)
    : assets;

  return jsonResponse({
    assets: filtered,
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : null,
    count: filtered.length,
  }, origin);
}

// ── GET asset metadata ──────────────────────────────────────────────────────
async function handleGetAssetMeta(env, key, origin) {
  const obj = await env.GRUDGE_ASSETS.head(key);
  if (!obj) return new Response('Not Found', { status: 404 });

  return jsonResponse({
    key, size: obj.size,
    uploaded: obj.uploaded?.toISOString() || null,
    etag: obj.httpEtag || null,
    contentType: obj.httpMetadata?.contentType || null,
    category: obj.customMetadata?.category || detectCategory(key),
    tags: safeParse(obj.customMetadata?.tags),
    description: obj.customMetadata?.description || null,
  }, origin);
}

// ── POST upload (multipart/form-data) ───────────────────────────────────────
async function handleUploadAsset(request, env, ctx, origin) {
  let fd;
  try { fd = await request.formData(); }
  catch { return jsonResponse({ error: 'Invalid multipart form data' }, origin, 400); }

  const file = fd.get('file');
  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'Missing file field' }, origin, 400);
  }

  const key = fd.get('key') || `uploads/${Date.now()}-${file.name || 'file'}`;
  const category = fd.get('category') || detectCategory(key);
  const tags = fd.get('tags') || '[]';
  const description = fd.get('description') || file.name || '';
  const ext = key.split('.').pop().toLowerCase();
  const contentType = file.type || mimeFromExt(ext);

  await env.GRUDGE_ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { category, tags, description, uploadedBy: 'objectstore-api' },
  });

  // Invalidate edge cache for this key
  const cache = caches.default;
  ctx.waitUntil(cache.delete(new Request(new URL(`/${key}`, request.url).toString())));

  return jsonResponse({
    success: true, key, size: file.size, contentType, category,
    tags: safeParse(tags),
    url: `/v1/assets/${encodeURIComponent(key)}/file`,
  }, origin, 201);
}

// ── PUT raw upload ──────────────────────────────────────────────────────────
async function handlePutAsset(request, env, key, origin) {
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  await env.GRUDGE_ASSETS.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { category: detectCategory(key), uploadedBy: 'objectstore-api-put' },
  });
  return jsonResponse({ success: true, key, contentType }, origin, 201);
}

// ── DELETE asset ────────────────────────────────────────────────────────────
async function handleDeleteAsset(env, key, origin) {
  await env.GRUDGE_ASSETS.delete(key);
  return jsonResponse({ success: true, deleted: key }, origin);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CDN READ HANDLER
// ═════════════════════════════════════════════════════════════════════════════

async function handleCDNRead(request, env, ctx, url, origin) {
  const key = decodeURIComponent(url.pathname.slice(1));

  if (!key) {
    return new Response(
      'Grudge Studio ObjectStore\nhttps://objectstore.grudge-studio.com\nhttps://assets.grudge-studio.com\n',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  }

  // ── Rate limit ────────────────────────────────────────────────────────
  if (env.RATE_LIMIT) {
    const blocked = await checkRateLimit(env, request, RL_READ_MAX);
    if (blocked) return blocked;
  }

  // ── Edge cache ────────────────────────────────────────────────────────
  const cache    = caches.default;
  const cacheKey = new Request(url.toString());
  const cached   = await cache.match(cacheKey);

  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set('CF-Cache-Status', 'HIT');
    applyCORS(hit.headers, origin);
    return hit;
  }

  // ── Conditional requests ──────────────────────────────────────────────
  const r2Opts = {};
  const ifNoneMatch     = request.headers.get('If-None-Match');
  const ifModifiedSince = request.headers.get('If-Modified-Since');
  if (ifNoneMatch || ifModifiedSince) {
    r2Opts.onlyIf = {
      ...(ifNoneMatch     ? { etagMatches: ifNoneMatch }                  : {}),
      ...(ifModifiedSince ? { uploadedBefore: new Date(ifModifiedSince) } : {}),
    };
  }

  // ── R2 fetch ──────────────────────────────────────────────────────────
  const object = await env.GRUDGE_ASSETS.get(key, r2Opts);
  if (!object) return new Response('Not Found', { status: 404 });
  if (!object.body) return new Response(null, { status: 304 });

  // ── Response headers ──────────────────────────────────────────────────
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag',          object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'bytes');

  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options',    'nosniff');
  headers.set('X-Frame-Options',           'DENY');
  headers.set('Referrer-Policy',           'strict-origin-when-cross-origin');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  const isMutable = MUTABLE_PREFIXES.some(p => key.startsWith(p));
  headers.set('Cache-Control', isMutable ? CACHE_MUTABLE : CACHE_IMMUTABLE);
  headers.set('CF-Cache-Status', 'MISS');
  headers.set('Vary', 'Accept, Accept-Encoding, Origin');

  applyCORS(headers, origin);

  const response = new Response(object.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function jsonResponse(data, origin, status = 200) {
  const res = new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  applyCORS(res.headers, origin);
  return res;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { return DYNAMIC_ORIGIN_RE.test(new URL(origin).hostname); } catch { return false; }
}

function corsResponse(origin, status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : '*',
      ...extra,
    },
  });
}

function applyCORS(headers, origin) {
  headers.set('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : '*');
  headers.set('Access-Control-Expose-Headers', 'ETag, CF-Cache-Status, Content-Length');
  headers.append('Vary', 'Origin');
}

async function checkRateLimit(env, request, max) {
  const ip    = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rlKey = `rl:${ip}`;
  const cur   = await env.RATE_LIMIT.get(rlKey);
  const count = cur ? parseInt(cur, 10) : 0;
  if (count >= max) {
    return new Response('Too Many Requests', {
      status: 429, headers: { 'Retry-After': String(RL_WINDOW) },
    });
  }
  env.RATE_LIMIT.put(rlKey, String(count + 1), { expirationTtl: RL_WINDOW });
  return null;
}

function detectCategory(key) {
  const parts = key.split('/');
  if (parts[0] === 'effects' && parts[1] === 'spells') return 'Spell Effects';
  if (parts[0] === 'effects') return 'Effects';
  if (parts[0] === 'models' && parts.length > 2) return parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
  if (parts[0] === 'avatars') return 'Avatars';
  if (parts[0] === 'game-assets') return 'Game Assets';
  if (parts[0] === 'animations') return 'Animations';
  if (parts[0] === 'textures') return 'Textures';
  if (parts[0] === 'audio') return 'Audio';
  if (parts.length > 1) return parts[0];
  return 'uncategorized';
}

function mimeFromExt(ext) {
  const map = {
    glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    fbx: 'application/octet-stream', obj: 'text/plain',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif',
    json: 'application/json', mp3: 'audio/mpeg', ogg: 'audio/ogg',
    wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
    wasm: 'application/wasm', zip: 'application/zip',
    bin: 'application/octet-stream',
  };
  return map[ext] || 'application/octet-stream';
}

function safeParse(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try { return JSON.parse(str); } catch { return []; }
}
