const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

// All session routes require auth
router.use(requireAuth);

// ── GET /sessions ─────────────────────────────────────────────────
// Returns all registered computers (launcher sessions) for current user.
router.get('/', async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT computer_id, platform, label, launcher_version, first_seen, last_seen, is_revoked
       FROM computer_registrations
       WHERE grudge_id = ?
       ORDER BY last_seen DESC`,
      [me]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /sessions/:computer_id/label ────────────────────────────
// Set a friendly name for a registered computer.
router.patch('/:computer_id/label', async (req, res, next) => {
  const me = req.user.grudge_id;
  const { label } = req.body;
  if (!label || typeof label !== 'string' || label.length > 64) {
    return res.status(400).json({ error: 'label must be a non-empty string up to 64 chars' });
  }
  try {
    const db = getDB();
    const [result] = await db.query(
      'UPDATE computer_registrations SET label = ? WHERE computer_id = ? AND grudge_id = ?',
      [label, req.params.computer_id, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Computer not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /sessions/:computer_id ─────────────────────────────────
// Revoke a registered computer. Launcher on that machine will need to re-register.
router.delete('/:computer_id', async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [result] = await db.query(
      `UPDATE computer_registrations SET is_revoked = TRUE
       WHERE computer_id = ? AND grudge_id = ?`,
      [req.params.computer_id, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Computer not found' });
    res.json({ ok: true, revoked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
