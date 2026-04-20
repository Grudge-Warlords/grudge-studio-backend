/**
 * RTS Config Routes — Balance & game config persistence for Gruda Armada
 *
 * Stored in R2 object storage, cached in Redis.
 * Read is public (no auth). Write requires admin JWT or internal API key.
 *
 * GET  /rts-config/balance      → current ship balance overrides
 * PUT  /rts-config/balance      → save balance overrides (admin only)
 * GET  /rts-config/game-config  → game constants overrides
 * PUT  /rts-config/game-config  → save game config overrides (admin only)
 */

const { Router } = require('express');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getRedis } = require('../redis');

const router = Router();
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'rts-config:';

// ── S3 client singleton ──────────────────────────────────────────
let _s3;
function getS3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.OBJECT_STORAGE_REGION || 'auto',
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_KEY,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

function getBucket() {
  return process.env.GAME_DATA_BUCKET || process.env.OBJECT_STORAGE_BUCKET || 'grudge-assets';
}

// ── Auth check: internal key OR admin role ────────────────────────
function requireAdmin(req, res, next) {
  if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) return next();
  if (req.user?.role === 'admin' || req.user?.is_admin) return next();
  // Fallback: check admin password header (for admin panel without full JWT role)
  if (req.headers['x-admin-key'] === process.env.ADMIN_API_KEY) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// ── Helper: fetch JSON from R2 ───────────────────────────────────
async function fetchFromR2(key) {
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  const resp = await getS3().send(cmd);
  const body = await resp.Body.transformToString('utf-8');
  return JSON.parse(body);
}

// ── Helper: write JSON to R2 ─────────────────────────────────────
async function writeToR2(key, data) {
  const json = JSON.stringify(data, null, 2);
  await getS3().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: json,
    ContentType: 'application/json',
  }));
}

// ── Generic GET handler ──────────────────────────────────────────
async function handleGet(configKey, req, res) {
  const cacheKey = `${CACHE_PREFIX}${configKey}`;
  const redis = getRedis();

  try {
    // 1. Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ success: true, configKey, cached: true, data: JSON.parse(cached) });
    }

    // 2. Fetch from R2
    const storageKey = `game-data/rts/${configKey}.json`;
    const data = await fetchFromR2(storageKey);

    // 3. Cache in Redis
    await redis.set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL);

    res.json({ success: true, configKey, cached: false, data });
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      // No config saved yet — return empty (use defaults)
      return res.json({ success: true, configKey, cached: false, data: null });
    }
    console.error(`[rts-config] Error fetching ${configKey}:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to load config' });
  }
}

// ── Generic PUT handler ──────────────────────────────────────────
async function handlePut(configKey, req, res) {
  const { data } = req.body;
  if (data === undefined) {
    return res.status(400).json({ error: 'data field required' });
  }

  try {
    const storageKey = `game-data/rts/${configKey}.json`;
    await writeToR2(storageKey, data);

    // Flush Redis cache
    const redis = getRedis();
    await redis.del(`${CACHE_PREFIX}${configKey}`);

    res.json({ success: true, configKey, saved: true });
  } catch (err) {
    console.error(`[rts-config] Error saving ${configKey}:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
}

// ── Routes ───────────────────────────────────────────────────────
router.get('/balance', (req, res) => handleGet('balance', req, res));
router.put('/balance', requireAdmin, (req, res) => handlePut('balance', req, res));

router.get('/game-config', (req, res) => handleGet('game-config', req, res));
router.put('/game-config', requireAdmin, (req, res) => handlePut('game-config', req, res));

module.exports = router;
