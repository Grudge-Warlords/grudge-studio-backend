const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireInternal(req, res, next) {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { requireAuth, requireInternal };
