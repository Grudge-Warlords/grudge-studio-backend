const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

// All puter routes require auth
router.use(requireAuth);

// ── GET /puter/link ───────────────────────────────────────────────
// Returns the user's puter_id so the client can scope Puter FS paths.
// The client uses puter.js SDK client-side; this just provides the namespace.
// Puter path convention: /grudge/{puter_id}/saves/{char_id}/{save_key}.json
router.get('/link', async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [[user]] = await db.query(
      'SELECT puter_id, username FROM users WHERE grudge_id = ?',
      [me]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      puter_id: user.puter_id,
      saves_path: `/grudge/${user.puter_id}/saves`,
      exports_path: `/grudge/${user.puter_id}/exports`,
      screenshots_path: `/grudge/${user.puter_id}/screenshots`,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /puter/saves ─────────────────────────────────────────────
// Record or update a cloud save entry after client syncs via puter.js.
// Body: { char_id?, save_key, puter_path, size_bytes?, checksum? }
router.post('/saves', async (req, res, next) => {
  const me = req.user.grudge_id;
  const { char_id = null, save_key, puter_path, size_bytes = 0, checksum = null } = req.body;
  if (!save_key || !puter_path) {
    return res.status(400).json({ error: 'save_key and puter_path are required' });
  }
  try {
    const db = getDB();
    const [result] = await db.query(
      `INSERT INTO cloud_saves (grudge_id, char_id, save_key, puter_path, size_bytes, checksum)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         puter_path  = VALUES(puter_path),
         size_bytes  = VALUES(size_bytes),
         checksum    = VALUES(checksum),
         synced_at   = CURRENT_TIMESTAMP`,
      [me, char_id, save_key, puter_path, size_bytes, checksum]
    );

    // Award 'puter_sync' achievement (first time only — idempotent)
    await db.query(
      'INSERT IGNORE INTO user_achievements (grudge_id, achievement_key) VALUES (?, ?)',
      [me, 'puter_sync']
    ).catch(() => {/* best-effort */});

    res.status(201).json({ id: result.insertId || 'updated', save_key, puter_path });
  } catch (err) {
    next(err);
  }
});

// ── GET /puter/saves/:char_id ─────────────────────────────────────
// List all cloud save entries for a character. Use 'account' for account-level saves.
router.get('/saves/:char_id', async (req, res, next) => {
  const me = req.user.grudge_id;
  const charIdParam = req.params.char_id;
  const char_id = charIdParam === 'account' ? null : charIdParam;
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT id, save_key, puter_path, size_bytes, checksum, synced_at, created_at
       FROM cloud_saves
       WHERE grudge_id = ?
         AND ${char_id === null ? 'char_id IS NULL' : 'char_id = ?'}
       ORDER BY synced_at DESC`,
      char_id === null ? [me] : [me, char_id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /puter/saves/:id ───────────────────────────────────────
// Remove a save record from our DB. Does NOT delete from Puter — client handles that.
router.delete('/saves/:id', async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [result] = await db.query(
      'DELETE FROM cloud_saves WHERE id = ? AND grudge_id = ?',
      [req.params.id, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Save record not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
