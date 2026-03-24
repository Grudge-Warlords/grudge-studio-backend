/**
 * Hero Ship Routes — Custom hero ship save/load for Gruda Armada
 *
 * One hero ship per account. GLB stored in R2, meta in MySQL.
 *
 * GET    /hero-ship/exists  → { exists: boolean }
 * GET    /hero-ship         → { meta, glbBase64 }
 * POST   /hero-ship         → save meta + GLB
 * DELETE /hero-ship         → remove hero ship
 */

const { Router } = require('express');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const router = Router();

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
  return process.env.OBJECT_STORAGE_BUCKET || 'grudge-assets';
}

function glbKey(grudgeId) {
  return `hero-ships/${grudgeId}.glb`;
}

// ── GET /hero-ship/exists ────────────────────────────────────────
router.get('/exists', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const db = require('../db').getDB();
    const [[row]] = await db.query(
      'SELECT id FROM hero_ships WHERE grudge_id = ? LIMIT 1',
      [grudgeId]
    );
    res.json({ exists: !!row });
  } catch (err) { next(err); }
});

// ── GET /hero-ship ───────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const db = require('../db').getDB();
    const [[row]] = await db.query(
      'SELECT name, voxel_count, grid_data, created_at FROM hero_ships WHERE grudge_id = ? LIMIT 1',
      [grudgeId]
    );
    if (!row) return res.status(404).json({ error: 'No hero ship found' });

    // Fetch GLB from object storage
    try {
      const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: glbKey(grudgeId) });
      const resp = await getS3().send(cmd);
      const chunks = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const glbBase64 = buffer.toString('base64');

      res.json({
        meta: {
          name: row.name,
          createdAt: new Date(row.created_at).getTime(),
          voxelCount: row.voxel_count,
          gridData: row.grid_data || undefined,
        },
        glbBase64,
      });
    } catch (storageErr) {
      // GLB missing from storage but meta exists — stale record
      console.warn('[hero-ships] GLB missing for', grudgeId, storageErr.message);
      res.status(404).json({ error: 'Hero ship GLB not found in storage' });
    }
  } catch (err) { next(err); }
});

// ── POST /hero-ship ──────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const { meta, glbBase64 } = req.body;
    if (!meta || !glbBase64) {
      return res.status(400).json({ error: 'meta and glbBase64 required' });
    }

    // Upload GLB to R2
    const glbBuffer = Buffer.from(glbBase64, 'base64');
    if (glbBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'GLB too large (max 5MB)' });
    }

    await getS3().send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: glbKey(grudgeId),
      Body: glbBuffer,
      ContentType: 'model/gltf-binary',
    }));

    // Upsert meta into MySQL
    const db = require('../db').getDB();
    await db.query(
      `INSERT INTO hero_ships (grudge_id, name, voxel_count, grid_data)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         voxel_count = VALUES(voxel_count),
         grid_data = VALUES(grid_data),
         updated_at = NOW()`,
      [grudgeId, meta.name || 'Custom Hero', meta.voxelCount || 0, meta.gridData || null]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /hero-ship ────────────────────────────────────────────
router.delete('/', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    // Delete from R2
    try {
      await getS3().send(new DeleteObjectCommand({
        Bucket: getBucket(),
        Key: glbKey(grudgeId),
      }));
    } catch { /* ignore if not found */ }

    // Delete from MySQL
    const db = require('../db').getDB();
    await db.query('DELETE FROM hero_ships WHERE grudge_id = ?', [grudgeId]);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
