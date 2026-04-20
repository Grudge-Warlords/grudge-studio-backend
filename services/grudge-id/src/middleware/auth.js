const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const ROLE_RANK = { guest: 0, pleb: 10, member: 20, admin: 50, master: 100 };

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const cookie = req.cookies?.grudge_sso;
  const raw = (header?.startsWith('Bearer ') ? header.slice(7) : null) || cookie;
  if (!raw) return res.status(401).json({ error: 'Authorization required' });
  try {
    req.user = jwt.verify(raw, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// requireRole('admin') → user must be admin OR master
// requireRole('master') → user must be master only
function requireRole(...roles) {
  const minRank = Math.min(...roles.map(r => ROLE_RANK[r] ?? 999));
  return [requireAuth, (req, res, next) => {
    const userRank = ROLE_RANK[req.user?.role] ?? 0;
    if (userRank < minRank) {
      return res.status(403).json({ error: 'Insufficient permissions', required: roles });
    }
    next();
  }];
}

module.exports = { requireAuth, requireRole, ROLE_RANK };
