const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { getDB } = require('../db');

// All admin routes require at minimum 'admin' role
const isAdmin = requireRole('admin');

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get('/users', ...isAdmin, async (req, res, next) => {
  try {
    const db = getDB();
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.q ? `%${req.query.q}%` : null;

    const where = search
      ? 'WHERE username LIKE ? OR email LIKE ? OR grudge_id LIKE ?'
      : '';
    const params = search ? [search, search, search, limit, offset] : [limit, offset];

    const [users] = await db.query(
      `SELECT id, grudge_id, username, display_name, email, role, is_guest, is_banned,
              ban_reason, gold, gbux_balance, faction, race, class, discord_tag,
              github_username, created_at, last_login
       FROM users ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM users ${where}`,
      search ? [search, search, search] : []
    );
    res.json({ users, total, limit, offset });
  } catch (err) { next(err); }
});

// ── PATCH /admin/users/:grudge_id/role ─────────────────────────────────────
// Only master can promote to admin or master
router.patch('/users/:grudge_id/role', ...requireRole('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    const valid = ['pleb', 'member', 'admin', 'master'];
    if (!valid.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${valid.join(', ')}` });
    }
    // Only master can grant admin/master
    if (['admin', 'master'].includes(role) && req.user.role !== 'master') {
      return res.status(403).json({ error: 'Only master can grant admin/master roles' });
    }
    const db = getDB();
    await db.query('UPDATE users SET role = ? WHERE grudge_id = ?', [role, req.params.grudge_id]);
    res.json({ success: true, grudge_id: req.params.grudge_id, role });
  } catch (err) { next(err); }
});

// ── PATCH /admin/users/:grudge_id/ban ──────────────────────────────────────
router.patch('/users/:grudge_id/ban', ...isAdmin, async (req, res, next) => {
  try {
    const { banned, reason } = req.body;
    const db = getDB();
    await db.query(
      'UPDATE users SET is_banned = ?, ban_reason = ? WHERE grudge_id = ?',
      [banned ? 1 : 0, reason || null, req.params.grudge_id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get('/stats', ...isAdmin, async (req, res, next) => {
  try {
    const db = getDB();
    const [[counts]] = await db.query(
      `SELECT
        COUNT(*) as total,
        SUM(role = 'master') as masters,
        SUM(role = 'admin')  as admins,
        SUM(role = 'member') as members,
        SUM(role = 'pleb')   as plebs,
        SUM(is_guest = 1)    as guests,
        SUM(is_banned = 1)   as banned,
        SUM(last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as active_24h,
        SUM(last_login > DATE_SUB(NOW(), INTERVAL 7 DAY))  as active_7d
       FROM users`
    );
    res.json(counts);
  } catch (err) { next(err); }
});

module.exports = router;
