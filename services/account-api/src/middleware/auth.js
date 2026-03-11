const jwt = require('jsonwebtoken');

/**
 * requireAuth — validates Grudge ID JWT from Authorization: Bearer header.
 * Sets req.user = { grudge_id, username, ... }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireInternal — validates x-internal-key header for service-to-service calls.
 * Used by game-api / ai-agent to award achievements, post notifications, etc.
 */
function requireInternal(req, res, next) {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/**
 * requireAuthOrInternal — accepts either a valid JWT or a valid internal key.
 */
function requireAuthOrInternal(req, res, next) {
  if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
    req.isInternal = true;
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth, requireInternal, requireAuthOrInternal };
