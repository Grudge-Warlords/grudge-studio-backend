const router = require('express').Router();
const { getDB } = require('../db');
const { requireInternal } = require('../middleware/auth');

// All version management requires internal key
router.use(requireInternal);

// ── POST /versions ────────────────────────────────────────────────
// Create a new launcher version record.
// If set_current=true, the previous current for that channel is demoted.
// Body: {
//   version, channel?, set_current?,
//   windows_url?, windows_sha256?,
//   mac_url?, mac_sha256?,
//   linux_url?, linux_sha256?,
//   patch_notes?, min_version?
// }
router.post('/', async (req, res, next) => {
  const {
    version, channel = 'stable', set_current = false,
    windows_url = null, windows_sha256 = null,
    mac_url = null, mac_sha256 = null,
    linux_url = null, linux_sha256 = null,
    patch_notes = null, min_version = null,
  } = req.body;

  if (!version) return res.status(400).json({ error: 'version is required' });
  if (!['stable', 'beta', 'dev'].includes(channel)) {
    return res.status(400).json({ error: 'channel must be stable, beta, or dev' });
  }

  const db = getDB();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Demote current version if we're setting a new current
    if (set_current) {
      await conn.query(
        'UPDATE launcher_versions SET is_current = FALSE WHERE channel = ? AND is_current = TRUE',
        [channel]
      );
    }

    const [result] = await conn.query(
      `INSERT INTO launcher_versions
         (version, channel, windows_url, windows_sha256, mac_url, mac_sha256,
          linux_url, linux_sha256, patch_notes, min_version, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [version, channel, windows_url, windows_sha256, mac_url, mac_sha256,
       linux_url, linux_sha256, patch_notes, min_version, set_current ? 1 : 0]
    );

    await conn.commit();
    res.status(201).json({ id: result.insertId, version, channel, is_current: set_current });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `Version '${version}' already exists` });
    }
    next(err);
  } finally {
    conn.release();
  }
});

// ── PATCH /versions/:version/current ─────────────────────────────
// Promote an existing version to current for its channel.
router.patch('/:version/current', async (req, res, next) => {
  const db = getDB();
  const conn = await db.getConnection();
  try {
    const [[target]] = await conn.query(
      'SELECT id, channel FROM launcher_versions WHERE version = ?',
      [req.params.version]
    );
    if (!target) return res.status(404).json({ error: 'Version not found' });

    await conn.beginTransaction();
    await conn.query(
      'UPDATE launcher_versions SET is_current = FALSE WHERE channel = ? AND is_current = TRUE',
      [target.channel]
    );
    await conn.query(
      'UPDATE launcher_versions SET is_current = TRUE WHERE id = ?',
      [target.id]
    );
    await conn.commit();
    res.json({ ok: true, version: req.params.version, channel: target.channel, is_current: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
