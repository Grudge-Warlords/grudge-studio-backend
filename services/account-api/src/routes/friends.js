const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

// All friend routes require auth
router.use(requireAuth);

// ── GET /friends ──────────────────────────────────────────────────
// List accepted friends + incoming pending requests for current user.
router.get('/', async (req, res, next) => {
  const me = req.user.grudge_id;
  try {
    const db = getDB();
    const [friends] = await db.query(
      `SELECT
         f.id,
         f.status,
         f.created_at,
         CASE
           WHEN f.requester_grudge_id = ? THEN f.addressee_grudge_id
           ELSE f.requester_grudge_id
         END AS friend_grudge_id,
         CASE
           WHEN f.requester_grudge_id = ? THEN 'sent'
           ELSE 'received'
         END AS direction,
         u.username, u.discord_tag, u.faction,
         p.avatar_url
       FROM friendships f
       JOIN users u ON u.grudge_id = (
         CASE WHEN f.requester_grudge_id = ? THEN f.addressee_grudge_id ELSE f.requester_grudge_id END
       )
       LEFT JOIN user_profiles p ON p.grudge_id = u.grudge_id
       WHERE (f.requester_grudge_id = ? OR f.addressee_grudge_id = ?)
         AND f.status IN ('accepted', 'pending')
       ORDER BY f.updated_at DESC`,
      [me, me, me, me, me]
    );
    res.json(friends);
  } catch (err) {
    next(err);
  }
});

// ── POST /friends/request ─────────────────────────────────────────
// Send a friend request to another user.
router.post('/request', async (req, res, next) => {
  const me = req.user.grudge_id;
  const { grudge_id: target } = req.body;
  if (!target || target === me) {
    return res.status(400).json({ error: 'Invalid target grudge_id' });
  }
  try {
    const db = getDB();
    // Verify target exists
    const [[user]] = await db.query('SELECT grudge_id FROM users WHERE grudge_id = ?', [target]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check for existing relationship (either direction)
    const [[existing]] = await db.query(
      `SELECT id, status FROM friendships
       WHERE (requester_grudge_id = ? AND addressee_grudge_id = ?)
          OR (requester_grudge_id = ? AND addressee_grudge_id = ?)`,
      [me, target, target, me]
    );
    if (existing) {
      return res.status(409).json({ error: `Relationship already exists: ${existing.status}` });
    }

    const [result] = await db.query(
      `INSERT INTO friendships (requester_grudge_id, addressee_grudge_id, status) VALUES (?, ?, 'pending')`,
      [me, target]
    );
    res.status(201).json({ id: result.insertId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /friends/:id ────────────────────────────────────────────
// Accept or decline a pending friend request.
// Body: { action: 'accept' | 'decline' | 'block' }
router.patch('/:id', async (req, res, next) => {
  const me = req.user.grudge_id;
  const { action } = req.body;
  if (!['accept', 'decline', 'block'].includes(action)) {
    return res.status(400).json({ error: 'action must be accept, decline, or block' });
  }
  try {
    const db = getDB();
    const [[row]] = await db.query(
      `SELECT * FROM friendships WHERE id = ? AND addressee_grudge_id = ? AND status = 'pending'`,
      [req.params.id, me]
    );
    if (!row) return res.status(404).json({ error: 'Friend request not found' });

    if (action === 'decline') {
      await db.query('DELETE FROM friendships WHERE id = ?', [row.id]);
      return res.json({ ok: true, action: 'declined' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'blocked';
    await db.query('UPDATE friendships SET status = ? WHERE id = ?', [newStatus, row.id]);
    res.json({ ok: true, action, status: newStatus });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /friends/:grudge_id ────────────────────────────────────
// Unfriend or remove a block. Deletes the row entirely.
router.delete('/:grudge_id', async (req, res, next) => {
  const me = req.user.grudge_id;
  const target = req.params.grudge_id;
  try {
    const db = getDB();
    const [result] = await db.query(
      `DELETE FROM friendships
       WHERE (requester_grudge_id = ? AND addressee_grudge_id = ?)
          OR (requester_grudge_id = ? AND addressee_grudge_id = ?)`,
      [me, target, target, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'No relationship found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
