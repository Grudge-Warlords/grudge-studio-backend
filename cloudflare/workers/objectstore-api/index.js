/**
 * Grudge Studio — ObjectStore API Worker
 *
 * Serves objectstore.grudge-studio.com
 * Handles asset metadata (D1) + file storage (R2 native binding).
 * Public reads require no auth. Writes require X-API-Key header.
 *
 * API:
 *   GET  /health
 *   GET  /v1/assets             ?category=&tag=&q=&limit=&offset=
 *   GET  /v1/assets/:id         asset metadata
 *   GET  /v1/assets/:id/file    stream file from R2
 *   POST /v1/assets             multipart upload (auth required)
 *   DELETE /v1/assets/:id       delete (auth required)
 *
 * Wrangler bindings (wrangler.toml):
 *   env.BUCKET      — R2 bucket (grudge-assets)
 *   env.DB          — D1 database (grudge-objectstore)
 *   env.RATE_LIMIT  — KV namespace
 *   env.API_KEY     — wrangler secret (for write auth)
 */
// ── CORS
// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://grudgewarlords.com', 'https://www.grudgewarlords.com',
  'https://grudge-studio.com', 'https://grudgestudio.com',
  'https://grudgeplatform.io', 'https://www.grudgeplatform.io',
  'https://play.grudgeplatform.io',
  'https://dash.grudge-studio.com', 'https://game.grudge-studio.com',
  'https://nexus.grudge-studio.com', 'https://play.grudge-studio.com',
  'https://client.grudge-studio.com', 'https://auth.grudge-studio.com',
  'https://assets.grudge-studio.com', 'https://objectstore.grudge-studio.com',
  'https://grudgedot-launcher.vercel.app', 'https://grudge-platform.vercel.app',
  'https://warlord-crafting-suite.vercel.app', 'https://grudge-warlords-game.vercel.app',
  'https://gruda-wars.vercel.app', 'https://grudge-engine-web.vercel.app',
  'https://nexus-nemesis-game.vercel.app', 'https://grim-armada-web.vercel.app',
  'https://nemesis.grudge-studio.com',
  'https://app.puter.com', 'https://molochdagod.github.io',
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, env) {
  const key = req.headers.get('X-API-Key') || req.headers.get('x-api-key');
  if (!key || key !== env.API_KEY) return false;
  return true;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const RL_MAX = 200; const RL_WIN = 60;
async function rateLimit(req, env, ctx) {
  if (!env.RATE_LIMIT) return false;
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rl:os:${ip}`;
  const cur = await env.RATE_LIMIT.get(key);
  const n   = cur ? parseInt(cur, 10) : 0;
  if (n >= RL_MAX) return true; // blocked
  ctx.waitUntil(env.RATE_LIMIT.put(key, String(n + 1), { expirationTtl: RL_WIN }));
  return false;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function rowToAsset(row) {
  if (!row) return null;
  return {
    id:         row.id,
    key:        row.r2_key,
    filename:   row.filename,
    mime:       row.mime,
    size:       row.size || 0,
    sha256:     row.sha256 || null,
    category:   row.category || 'other',
    tags:       JSON.tryParse(row.tags) || [],
    visibility: row.visibility || 'public',
    metadata:   JSON.tryParse(row.metadata) || {},
    created_at: row.created_at,
  };
}
JSON.tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ── R2 key builder ────────────────────────────────────────────────────────────
function r2Key(category, id, filename) {
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  return `${category}/${id}.${ext}`;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleList(req, env, url, origin) {
  const q        = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const tag      = url.searchParams.get('tag') || '';
  const limit    = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset   = parseInt(url.searchParams.get('offset') || '0', 10);

  const CDN = (env.PUBLIC_CDN_URL || '').replace(/\/$/, '');

  // Build WHERE clause
  const conditions = ["visibility = 'public'"];
  const bindings   = [];
  if (category) { conditions.push('category = ?'); bindings.push(category); }
  if (tag)      { conditions.push('tags LIKE ?');  bindings.push(`%"${tag}"%`); }
  if (q)        { conditions.push('(filename LIKE ? OR tags LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt  = `SELECT * FROM assets ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const result = await env.DB.prepare(stmt)
    .bind(...bindings, limit, offset)
    .all();

  const items = (result.results || []).map(r => ({
    ...rowToAsset(r),
    file_url: `${CDN}/${r.r2_key}`,
  }));

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assets ${where}`
  ).bind(...bindings).first();

  return json({ items, count: countResult?.n ?? items.length, limit, offset }, 200, origin);
}

async function handleGetOne(id, env, origin) {
  const row = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404, origin);
  const CDN = (env.PUBLIC_CDN_URL || '').replace(/\/$/, '');
  return json({ ...rowToAsset(row), file_url: `${CDN}/${row.r2_key}` }, 200, origin);
}

async function handleGetFile(id, env, req, origin) {
  const row = await env.DB.prepare('SELECT r2_key FROM assets WHERE id = ?').bind(id).first();
  if (!row) return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) return new Response('Not Found in R2', { status: 404, headers: corsHeaders(origin) });

  const headers = new Headers(corsHeaders(origin));
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function handleUpload(req, env, origin) {
  if (!requireAuth(req, env)) {
    return json({ error: 'Forbidden — X-API-Key required' }, 403, origin);
  }

  const maxBytes = parseInt(env.MAX_UPLOAD_BYTES || '104857600', 10);
  const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (contentLength > maxBytes) {
    return json({ error: `File too large (max ${maxBytes / 1024 / 1024} MB)` }, 413, origin);
  }

  const formData = await req.formData();
  const file     = formData.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'file field required (multipart/form-data)' }, 400, origin);
  }

  const filename   = formData.get('filename') || file.name || 'upload';
  const category   = (formData.get('category') || 'other').toString().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const tags       = JSON.tryParse(formData.get('tags') || '[]') || [];
  const visibility = formData.get('visibility') || 'public';
  const metadata   = JSON.tryParse(formData.get('metadata') || '{}') || {};
  const mime       = file.type || 'application/octet-stream';

  // Use provided r2_key (for pre-uploaded files) or generate UUID-based key
  const providedKey = formData.get('r2_key');
  const id  = crypto.randomUUID();
  const key = providedKey ? providedKey.toString() : r2Key(category, id, filename);

  // Upload to R2 (skip if r2_key was provided — file already in R2)
  const buffer = await file.arrayBuffer();
  if (!providedKey) {
    await env.BUCKET.put(key, buffer, {
      httpMetadata: { contentType: mime },
      customMetadata: { originalFilename: filename },
    });
  }
  const size = buffer.byteLength;

  // Insert metadata into D1
  await env.DB.prepare(
    `INSERT INTO assets (id, r2_key, filename, mime, size, category, tags, visibility, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, key, filename, mime, size,
    category,
    JSON.stringify(tags),
    visibility,
    JSON.stringify(metadata)
  ).run();

  const CDN = (env.PUBLIC_CDN_URL || '').replace(/\/$/, '');
  return json({
    id, key, filename, mime, size, category, tags, visibility,
    url: `${CDN}/${key}`,
    created_at: new Date().toISOString(),
  }, 201, origin);
}

// ── Bulk index (register pre-uploaded R2 files into D1 without re-uploading) ──
async function handleBulkIndex(req, env, origin) {
  if (!requireAuth(req, env)) return json({ error: 'Forbidden' }, 403, origin);
  const { assets } = await req.json().catch(() => ({ assets: [] }));
  if (!Array.isArray(assets) || !assets.length) return json({ error: 'assets[] required' }, 400, origin);

  const CDN = (env.PUBLIC_CDN_URL || '').replace(/\/$/, '');
  let inserted = 0; let skipped = 0;
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO assets (id, r2_key, filename, mime, size, category, tags, visibility, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'public', '{}', datetime('now'))`
  );
  for (const a of assets) {
    if (!a.key) continue;
    const existing = await env.DB.prepare('SELECT id FROM assets WHERE r2_key = ?').bind(a.key).first();
    if (existing) { skipped++; continue; }
    const id = a.id || crypto.randomUUID();
    const fname = a.filename || a.key.split('/').pop();
    const mime  = a.mime || (fname.endsWith('.png') ? 'image/png' : fname.endsWith('.jpg') ? 'image/jpeg' : fname.endsWith('.glb') ? 'model/gltf-binary' : fname.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream');
    const tags  = JSON.stringify(a.tags || []);
    await stmt.bind(id, a.key, fname, mime, a.size || 0, a.category || 'other', tags).run();
    inserted++;
  }
  return json({ inserted, skipped, total: assets.length, cdn: CDN }, 200, origin);
}

async function handleDelete(id, env, origin) {
  const row = await env.DB.prepare('SELECT r2_key FROM assets WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404, origin);

  await env.BUCKET.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();

  return json({ deleted: true, id }, 200, origin);
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const origin = request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'objectstore-api', bucket: 'grudge-assets' }, 200, origin);
    }

    // Rate limiting
    if (await rateLimit(request, env, ctx)) {
      return json({ error: 'Too many requests' }, 429, origin);
    }

    const path = url.pathname;

    // GET /v1/assets
    if (method === 'GET' && path === '/v1/assets') {
      return handleList(request, env, url, origin);
    }

    // POST /v1/assets  (upload)
    if (method === 'POST' && path === '/v1/assets') {
      return handleUpload(request, env, origin);
    }

    // POST /v1/assets/bulk-index  (register pre-uploaded R2 files into D1)
    if (method === 'POST' && path === '/v1/assets/bulk-index') {
      return handleBulkIndex(request, env, origin);
    }

    // GET /v1/assets/:id/file
    const fileMatch = path.match(/^\/v1\/assets\/([^/]+)\/file$/);
    if (fileMatch && method === 'GET') {
      return handleGetFile(fileMatch[1], env, request, origin);
    }

    // GET /v1/assets/:id
    const assetMatch = path.match(/^\/v1\/assets\/([^/]+)$/);
    if (assetMatch) {
      if (method === 'GET')    return handleGetOne(assetMatch[1], env, origin);
      if (method === 'DELETE') {
        if (!requireAuth(request, env)) return json({ error: 'Forbidden' }, 403, origin);
        return handleDelete(assetMatch[1], env, origin);
      }
    }

    return json({ error: 'Not Found', path }, 404, origin);
  },
};
