const router = require('express').Router();
const multer = require('multer');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── S3 client (Cloudflare R2 / Backblaze B2 / AWS S3 compatible) ──
const s3 = new S3Client({
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
  region:   process.env.OBJECT_STORAGE_REGION || 'auto', // R2 uses 'auto'
  credentials: {
    accessKeyId:     process.env.OBJECT_STORAGE_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
  },
  // R2 account-level endpoint uses path style: endpoint/bucket/key
  forcePathStyle: true,
});

// multer memory storage — 2 MB cap, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// ── GET /profile/:grudge_id ───────────────────────────────────────
// Public — returns merged users + user_profiles row.
router.get('/:grudge_id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT u.grudge_id, u.username, u.discord_tag, u.faction, u.race, u.class,
              u.created_at AS member_since,
              p.avatar_url, p.bio, p.social_links, p.country
       FROM users u
       LEFT JOIN user_profiles p ON p.grudge_id = u.grudge_id
       WHERE u.grudge_id = ? AND u.is_active = TRUE AND u.is_banned = FALSE`,
      [req.params.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /profile/:grudge_id ─────────────────────────────────────
// Auth required — only the owner may update their own profile.
router.patch('/:grudge_id', requireAuth, async (req, res, next) => {
  if (req.user.grudge_id !== req.params.grudge_id) {
    return res.status(403).json({ error: 'Cannot modify another user\'s profile' });
  }
  const { bio, social_links, country } = req.body;
  try {
    const db = getDB();
    await db.query(
      `INSERT INTO user_profiles (grudge_id, bio, social_links, country)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bio          = COALESCE(VALUES(bio), bio),
         social_links = COALESCE(VALUES(social_links), social_links),
         country      = COALESCE(VALUES(country), country)`,
      [
        req.params.grudge_id,
        bio ?? null,
        social_links ? JSON.stringify(social_links) : null,
        country ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /profile/avatar ──────────────────────────────────────────
// Auth required — uploads avatar to S3, stores CDN URL in user_profiles.
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const grudge_id = req.user.grudge_id;
  const ext = req.file.mimetype === 'image/png' ? 'png' : 'webp';
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16);
  const key = `avatars/${grudge_id}/${hash}.${ext}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket:             process.env.OBJECT_STORAGE_BUCKET,
      Key:                key,
      Body:               req.file.buffer,
      ContentType:        req.file.mimetype,
      // Immutable cache — key contains SHA-256 hash so content never changes
      CacheControl:       'public, max-age=31536000, immutable',
      ContentDisposition: 'inline',
      // Cloudflare R2 custom metadata
      Metadata: {
        'grudge-id':    grudge_id,
        'uploaded-at':  new Date().toISOString(),
      },
    }));

    const avatar_url = `${process.env.OBJECT_STORAGE_PUBLIC_URL}/${key}`;

    const db = getDB();
    await db.query(
      `INSERT INTO user_profiles (grudge_id, avatar_url)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url)`,
      [grudge_id, avatar_url]
    );

    res.json({ avatar_url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
