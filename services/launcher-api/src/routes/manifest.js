const router = require('express').Router();
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getDB } = require('../db');

// ── In-memory cache for manifest responses ───────────────────────────────────
// The launcher calls GET /manifest on every startup to check for updates.
// Caching for 60s dramatically reduces DB reads without impacting update latency.
const manifestCache = new Map(); // channel -> { data, expiresAt }
const MANIFEST_TTL_MS = 60 * 1000; // 60 seconds

function getCachedManifest(channel) {
  const entry = manifestCache.get(channel);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}
function setCachedManifest(channel, data) {
  manifestCache.set(channel, { data, expiresAt: Date.now() + MANIFEST_TTL_MS });
}

const s3 = new S3Client({
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
  region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.OBJECT_STORAGE_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
  },
  forcePathStyle: true,
});

// Presign a download URL for the given S3 key (24h expiry).
// If the URL is already a full https:// URL (CDN or direct), return it as-is.
async function presignIfNeeded(url) {
  if (!url) return null;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  // Treat as an S3 object key
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET, Key: url }),
      { expiresIn: 86400 } // 24 hours
    );
  } catch {
    return url; // Fall back to raw key if presign fails
  }
}

// ── GET /manifest ─────────────────────────────────────────────────
// Returns the current stable version with download URLs.
// No auth required — called by launcher on startup to check for updates.
// Query: ?channel=stable|beta|dev (default: stable)
router.get('/', async (req, res, next) => {
  const channel = ['stable', 'beta', 'dev'].includes(req.query.channel)
    ? req.query.channel
    : 'stable';
  try {
    // Return cached response if still fresh
    const cached = getCachedManifest(channel);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const db = getDB();
    const [[version]] = await db.query(
      `SELECT id, version, channel, windows_url, windows_sha256,
              mac_url, mac_sha256, linux_url, linux_sha256,
              patch_notes, min_version, published_at
       FROM launcher_versions
       WHERE channel = ? AND is_current = TRUE
       LIMIT 1`,
      [channel]
    );

    if (!version) {
      return res.status(404).json({ error: `No current ${channel} version found` });
    }

    // Presign download URLs in parallel
    const [windows_url, mac_url, linux_url] = await Promise.all([
      presignIfNeeded(version.windows_url),
      presignIfNeeded(version.mac_url),
      presignIfNeeded(version.linux_url),
    ]);

    const payload = {
      version:      version.version,
      channel:      version.channel,
      min_version:  version.min_version,
      published_at: version.published_at,
      patch_notes:  version.patch_notes,
      cdn_base:     process.env.OBJECT_STORAGE_PUBLIC_URL || null,
      downloads: {
        windows: windows_url ? { url: windows_url, sha256: version.windows_sha256 } : null,
        mac:     mac_url     ? { url: mac_url,     sha256: version.mac_sha256     } : null,
        linux:   linux_url   ? { url: linux_url,   sha256: version.linux_sha256   } : null,
      },
    };

    setCachedManifest(channel, payload);
    res.set('X-Cache', 'MISS');
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// ── GET /manifest/history ─────────────────────────────────────────
// Returns last 10 versions (all channels) for changelog display.
router.get('/history', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT version, channel, patch_notes, min_version, is_current, published_at
       FROM launcher_versions
       ORDER BY published_at DESC
       LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
