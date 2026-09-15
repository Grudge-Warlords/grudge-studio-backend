/**
 * grudge-r2-cdn — Cloudflare Worker that serves game assets from R2.
 *
 * Features:
 *   - Correct Content-Type for 3D models (GLB, FBX, OBJ, glTF), images, audio
 *   - CORS headers for game clients
 *   - Immutable 30-day cache for versioned assets
 *   - Range request support for large binary files
 *   - Directory listing disabled (404 on folders)
 */

export interface Env {
  ASSETS: R2Bucket;
  ALLOWED_ORIGINS: string;
}

// ── MIME type map ─────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  // 3D Models
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.vox': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  // Video
  '.mp4': 'video/mp4',
  // Data
  '.json': 'application/json',
  '.txt': 'text/plain',
};

function getMimeType(key: string): string {
  const ext = key.substring(key.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ── CORS helper ───────────────────────────────────────────────────
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());

  // Allow any origin in dev, restrict in prod
  const isAllowed = allowed.includes(origin) || origin.includes('localhost');
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
  };
}

// ── Main handler ──────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Strip leading slash to get R2 key
    let key = decodeURIComponent(url.pathname.slice(1));
    if (!key || key.endsWith('/')) {
      return new Response(JSON.stringify({ error: 'Not found', hint: 'Provide a full asset path like /gruda-armada/models/ships/Warship/Warship.obj' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Range request support
    const rangeHeader = request.headers.get('Range');
    const options: R2GetOptions = {};
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : undefined;
        options.range = { offset: start, length: end !== undefined ? end - start + 1 : undefined };
      }
    }

    // Fetch from R2
    const object = await env.ASSETS.get(key, options);
    if (!object) {
      return new Response(JSON.stringify({ error: 'Asset not found', key }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const contentType = getMimeType(key);
    const headers: Record<string, string> = {
      ...cors,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=2592000, immutable',
      'Accept-Ranges': 'bytes',
      'ETag': object.httpEtag,
    };

    if (object.size !== undefined) {
      headers['Content-Length'] = String(object.size);
    }

    // Range response
    if (rangeHeader && options.range) {
      const offset = (options.range as { offset: number }).offset;
      const length = object.size;
      const end = options.range.length ? offset + options.range.length - 1 : (length ?? 0) - 1;
      headers['Content-Range'] = `bytes ${offset}-${end}/${length ?? '*'}`;
      headers['Content-Length'] = String(end - offset + 1);
      return new Response(object.body as ReadableStream, { status: 206, headers });
    }

    return new Response(object.body as ReadableStream, { status: 200, headers });
  },
};
