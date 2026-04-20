/**
 * AI Proxy — forwards authenticated requests from external clients
 * to the internal ai-agent service (not exposed directly).
 *
 * Mount: app.use('/ai', requireAuth, aiProxyRoutes)
 *
 * Supported routes (forwarded as-is to ai-agent):
 *   POST /ai/dev/review        → code review
 *   POST /ai/dev/generate      → C# code generation
 *   POST /ai/balance/analyze   → game balance analysis
 *   POST /ai/lore/generate     → lore / quest / dialogue
 *   POST /ai/art/prompt        → 3D model prompts
 *   POST /ai/companion/interact → companion dialogue
 *   POST /ai/mission/generate  → dynamic mission generation
 *   GET  /ai/llm/status        → LLM provider diagnostics
 *   GET  /ai/context           → game system context
 */

const express = require('express');
const router  = express.Router();

const AI_AGENT_URL    = process.env.AI_AGENT_URL || 'http://ai-agent:3004';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Rate limit AI proxy — 30 req/min per user (heavier than normal endpoints)
const rateLimit = require('express-rate-limit');
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => req.user?.grudge_id || req.ip,
  message: { error: 'AI rate limit exceeded — try again in a moment' },
});
router.use(aiLimiter);

// Generic proxy: forward everything under /ai/* to ai-agent
router.all('/*', async (req, res, next) => {
  try {
    const targetPath = req.originalUrl; // e.g. /ai/dev/review
    const url = `${AI_AGENT_URL}${targetPath}`;

    const headers = {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_API_KEY,
    };

    const fetchOpts = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, fetchOpts);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[game-api] AI proxy error:', err.message);
    next(err);
  }
});

module.exports = router;

