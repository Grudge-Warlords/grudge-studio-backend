/**
 * Game Data Routes — serves ObjectStore JSON from object storage with Redis cache.
 *
 * GET /game-data/:category  → weapons, armor, materials, races, classes, etc.
 * GET /game-data             → list all available categories
 *
 * Data source: object storage (MinIO local / Cloudflare R2 production)
 * Cache: Redis with 5-minute TTL
 *
 * ObjectStore key layout:  game-data/api/v1/{category}.json
 */

const { Router } = require('express');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getRedis } = require('../redis');

const router = Router();
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'gamedata:';
const STORAGE_PREFIX = 'game-data/api/v1/';

// Valid categories that map to ObjectStore JSON files
const CATEGORIES = [
  'weapons', 'armor', 'materials', 'consumables',
  'skills', 'professions', 'races', 'classes',
  'factions', 'attributes', 'bosses', 'enemies',
];

// ── S3 client singleton ──────────────────────────────────────────────────────
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
  // game-data lives in its own bucket locally (MinIO), or under a prefix in R2
  return process.env.GAME_DATA_BUCKET || process.env.OBJECT_STORAGE_BUCKET || 'grudge-assets';
}

// ── Helper: fetch JSON from object storage ───────────────────────────────────
async function fetchFromStorage(key) {
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  const resp = await getS3().send(cmd);
  const body = await resp.Body.transformToString('utf-8');
  return JSON.parse(body);
}

// ── GET /game-data — list available categories ───────────────────────────────
router.get('/', (req, res) => {
  res.json({
    success: true,
    categories: CATEGORIES,
    usage: 'GET /game-data/:category  (e.g. /game-data/weapons)',
    cache_ttl: CACHE_TTL,
  });
});

// ── GET /game-data/:category — return game data with Redis cache ─────────────
router.get('/:category', async (req, res) => {
  const { category } = req.params;

  if (!CATEGORIES.includes(category)) {
    return res.status(404).json({
      success: false,
      error: `Unknown category: ${category}`,
      available: CATEGORIES,
    });
  }

  const cacheKey = `${CACHE_PREFIX}${category}`;
  const redis = getRedis();

  try {
    // 1. Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        category,
        cached: true,
        data: JSON.parse(cached),
      });
    }

    // 2. Fetch from object storage
    const storageKey = `${STORAGE_PREFIX}${category}.json`;
    const data = await fetchFromStorage(storageKey);

    // 3. Cache in Redis
    await redis.set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL);

    res.json({ success: true, category, cached: false, data });
  } catch (err) {
    // If storage fetch fails, try serving stale cache
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({
        success: false,
        error: `Game data not found for: ${category}`,
        hint: 'Run migrate-objectstore.js to populate storage',
      });
    }
    console.error(`[game-data] Error fetching ${category}:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to load game data' });
  }
});

// ── POST /game-data/cache/flush — clear game data cache (internal only) ──────
router.post('/cache/flush', (req, res) => {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const redis = getRedis();
  const pipeline = redis.pipeline();
  CATEGORIES.forEach(c => pipeline.del(`${CACHE_PREFIX}${c}`));
  pipeline.exec();

  res.json({ success: true, flushed: CATEGORIES.length });
});

module.exports = router;
