const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const {
  presignUpload,
  presignDownload,
  resolveUrl,
  headObject,
  deleteObject,
  sha256: computeSha256,
  getPublicUrl,
} = require('../storage');

const router = express.Router();

// ── JWT Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Internal API key auth (service-to-service) ────────────────────
function internalAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key && key === process.env.INTERNAL_API_KEY) {
    req.internal = true;
    return next();
  }
  return auth(req, res, next);
}

// ── Helpers ───────────────────────────────────────────────────────
const VALID_CATEGORIES = [
  'model','texture','sprite','animation','audio','video',
  'icon','ui','config','bundle','avatar','build','other',
];

function sanitizeCategory(val) {
  return VALID_CATEGORIES.includes(val) ? val : 'other';
}

function r2Key(category, uuid, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return `${category}/${uuid}.${ext}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /assets/presign — Request presigned upload URL
// Body: { filename, mime, category?, tags?, visibility?, metadata? }
// Returns: { uuid, uploadUrl, r2Key }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/presign', internalAuth, async (req, res, next) => {
  try {
    const { filename, mime, category, tags, visibility, metadata } = req.body;
    if (!filename || !mime) return res.status(400).json({ error: 'filename and mime required' });

    const db = getDB();
    const assetUuid = uuidv4();
    const cat = sanitizeCategory(category);
    const key = r2Key(cat, assetUuid, filename);

    // Insert pending row (size/sha256 filled on complete)
    await db.execute(
      `INSERT INTO assets (uuid, r2_key, filename, mime, category, tags, visibility, owner_grudge_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetUuid,
        key,
        filename,
        mime,
        cat,
        tags ? JSON.stringify(tags) : null,
        visibility || 'public',
        req.user?.grudge_id || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    const uploadUrl = await presignUpload(key, mime, 3600);
    res.json({ uuid: assetUuid, uploadUrl, r2Key: key });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /assets/:uuid/complete — Finalize upload (verify R2 + fill size/hash)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/:uuid/complete', internalAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      'SELECT id, r2_key FROM assets WHERE uuid = ? AND is_deleted = FALSE',
      [req.params.uuid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });

    const asset = rows[0];
    const head = await headObject(asset.r2_key);
    if (!head) return res.status(409).json({ error: 'File not yet uploaded to R2' });

    const size = head.ContentLength || 0;
    await db.execute(
      'UPDATE assets SET size = ? WHERE id = ?',
      [size, asset.id]
    );

    const url = await resolveUrl(asset.r2_key);
    res.json({ uuid: req.params.uuid, size, url });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /assets — List / search
// Query: ?category=&q=&visibility=&owner=&page=&limit=
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const { category, q, visibility, owner, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * safeLimit;

    let where = 'is_deleted = FALSE';
    const params = [];

    if (category && VALID_CATEGORIES.includes(category)) {
      where += ' AND category = ?';
      params.push(category);
    }
    if (visibility) {
      where += ' AND visibility = ?';
      params.push(visibility);
    }
    if (owner) {
      where += ' AND owner_grudge_id = ?';
      params.push(owner);
    }
    if (q) {
      where += ' AND MATCH(filename) AGAINST(? IN BOOLEAN MODE)';
      params.push(`${q}*`);
    }

    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) as total FROM assets WHERE ${where}`, params
    );
    const [rows] = await db.execute(
      `SELECT uuid, r2_key, filename, mime, size, sha256, category, tags, visibility,
              owner_grudge_id, metadata, created_at, updated_at
       FROM assets WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    // Resolve CDN URLs
    for (const row of rows) {
      row.url = await resolveUrl(row.r2_key);
      if (row.tags && typeof row.tags === 'string') row.tags = JSON.parse(row.tags);
      if (row.metadata && typeof row.metadata === 'string') row.metadata = JSON.parse(row.metadata);
    }

    res.json({ total, page: parseInt(page, 10) || 1, limit: safeLimit, assets: rows });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /assets/:uuid — Get single asset
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/:uuid', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT uuid, r2_key, filename, mime, size, sha256, category, tags, visibility,
              owner_grudge_id, metadata, created_at, updated_at
       FROM assets WHERE uuid = ? AND is_deleted = FALSE`,
      [req.params.uuid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });

    const asset = rows[0];
    asset.url = await resolveUrl(asset.r2_key);
    if (asset.tags && typeof asset.tags === 'string') asset.tags = JSON.parse(asset.tags);
    if (asset.metadata && typeof asset.metadata === 'string') asset.metadata = JSON.parse(asset.metadata);

    res.json(asset);
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATCH /assets/:uuid — Update metadata/tags/visibility
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.patch('/:uuid', internalAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const { tags, visibility, metadata, category } = req.body;
    const sets = [];
    const params = [];

    if (tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (visibility)         { sets.push('visibility = ?'); params.push(visibility); }
    if (metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(metadata)); }
    if (category && VALID_CATEGORIES.includes(category)) { sets.push('category = ?'); params.push(category); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.uuid);
    const [result] = await db.execute(
      `UPDATE assets SET ${sets.join(', ')} WHERE uuid = ? AND is_deleted = FALSE`,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /assets/:uuid — Soft-delete
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:uuid', internalAuth, async (req, res, next) => {
  try {
    const db = getDB();
    const [result] = await db.execute(
      'UPDATE assets SET is_deleted = TRUE WHERE uuid = ? AND is_deleted = FALSE',
      [req.params.uuid]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.json({ deleted: true, uuid: req.params.uuid });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /assets/bundle — Create export bundle from asset UUIDs
// Body: { name, description?, assetUuids: string[] }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/bundle', internalAuth, async (req, res, next) => {
  try {
    const { name, description, assetUuids } = req.body;
    if (!name || !Array.isArray(assetUuids) || !assetUuids.length) {
      return res.status(400).json({ error: 'name and assetUuids[] required' });
    }

    const db = getDB();
    const bundleUuid = uuidv4();

    await db.execute(
      `INSERT INTO asset_bundles (uuid, name, description, owner_grudge_id, status)
       VALUES (?, ?, ?, ?, 'building')`,
      [bundleUuid, name, description || null, req.user?.grudge_id || null]
    );

    // Resolve asset internal IDs
    const placeholders = assetUuids.map(() => '?').join(',');
    const [assets] = await db.execute(
      `SELECT id, uuid FROM assets WHERE uuid IN (${placeholders}) AND is_deleted = FALSE`,
      assetUuids
    );
    if (!assets.length) {
      return res.status(400).json({ error: 'No valid assets found for the given UUIDs' });
    }

    // Get the bundle internal ID
    const [[bundle]] = await db.execute(
      'SELECT id FROM asset_bundles WHERE uuid = ?', [bundleUuid]
    );

    // Insert bundle items
    const values = assets.map(a => `(${bundle.id}, ${a.id})`).join(',');
    await db.execute(`INSERT INTO asset_bundle_items (bundle_id, asset_id) VALUES ${values}`);

    // Generate presigned download URLs for each asset
    const [bundleAssets] = await db.execute(
      `SELECT a.uuid, a.r2_key, a.filename, a.mime, a.size
       FROM asset_bundle_items bi
       JOIN assets a ON a.id = bi.asset_id
       WHERE bi.bundle_id = ?`,
      [bundle.id]
    );

    const downloads = [];
    for (const a of bundleAssets) {
      downloads.push({
        uuid: a.uuid,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        downloadUrl: await presignDownload(a.r2_key, 86400),
      });
    }

    // Mark bundle ready (actual zip creation deferred to Phase 3 worker)
    await db.execute(
      "UPDATE asset_bundles SET status = 'ready' WHERE id = ?",
      [bundle.id]
    );

    res.json({ bundleUuid, name, assetCount: assets.length, downloads });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /assets/conversion — Queue a format conversion
// Body: { sourceUuid, outputFormat }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/conversion', internalAuth, async (req, res, next) => {
  try {
    const { sourceUuid, outputFormat } = req.body;
    if (!sourceUuid || !outputFormat) {
      return res.status(400).json({ error: 'sourceUuid and outputFormat required' });
    }

    const db = getDB();
    const [rows] = await db.execute(
      'SELECT id, filename FROM assets WHERE uuid = ? AND is_deleted = FALSE',
      [sourceUuid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Source asset not found' });

    const source = rows[0];
    const inputFormat = source.filename.split('.').pop().toLowerCase();

    const [result] = await db.execute(
      `INSERT INTO asset_conversions (source_asset_id, input_format, output_format, status)
       VALUES (?, ?, ?, 'queued')`,
      [source.id, inputFormat, outputFormat]
    );

    res.json({ conversionId: result.insertId, status: 'queued', inputFormat, outputFormat });
  } catch (err) { next(err); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /assets/conversion/:id — Check conversion status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/conversion/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT c.id, c.input_format, c.output_format, c.status, c.error,
              c.started_at, c.completed_at, c.created_at,
              a.uuid as source_uuid, o.uuid as output_uuid
       FROM asset_conversions c
       JOIN assets a ON a.id = c.source_asset_id
       LEFT JOIN assets o ON o.id = c.output_asset_id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conversion not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
