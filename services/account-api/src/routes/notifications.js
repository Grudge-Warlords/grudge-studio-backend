const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth, requireInternal } = require('../middleware/auth');

// ── GET /notifications ────────────────────────────────────────────
// Returns the last 50 notifications for the authed user.
// Query: ?unread=1 to filter unread only.
router.get('/', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  const unreadOnly = req.query.unread === '1';
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT id, type, payload, is_read, created_at
       FROM notifications
       WHERE grudge_id = ?
         ${unreadOnly ? 'AND is_read = FALSE' : ''}
       ORDER BY created_at DESC
       LIMIT 50`,
      [me]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [result] = await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND grudge_id = ?',
      [req.params.id, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /notifications/read-all ─────────────────────────────────
router.patch('/read-all', requireAuth, async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE grudge_id = ? AND is_read = FALSE',
      [me]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /notifications — internal only ───────────────────────────
// Called by game-api / ai-agent to push a notification to a user.
// Body: { grudge_id, type, payload }
router.post('/', requireInternal, async (req, res, next) => {
  const { grudge_id, type, payload } = req.body;
  if (!grudge_id || !type) {
    return res.status(400).json({ error: 'grudge_id and type are required' });
  }
  try {
    const db = getDB();
    const [result] = await db.query(
      'INSERT INTO notifications (grudge_id, type, payload) VALUES (?, ?, ?)',
      [grudge_id, type, payload ? JSON.stringify(payload) : null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
