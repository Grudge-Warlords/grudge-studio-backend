'use strict';

/**
 * shared/idempotency.js — Redis-backed write idempotency for Grudge Studio
 *
 * Prevents duplicate economy spends, crafting starts, inventory mutations, etc.
 * when clients retry requests after a network error.
 *
 * Client sends:  X-Idempotency-Key: <uuid>
 * First call:    executes handler, caches response in Redis for TTL seconds
 * Repeat call:   returns cached response immediately; never re-executes handler
 * Response flag: X-Idempotency-Replay: true (on replayed responses)
 *
 * Usage in Express routes:
 *
 *   const { makeIdempotency } = require('../../shared/idempotency');
 *   const { idempotencyCheck, idempotencyCapture } = makeIdempotency(getRedis);
 *
 *   // Apply to any mutating endpoint
 *   router.post('/economy/spend',   idempotencyCheck, idempotencyCapture, spendHandler);
 *   router.post('/crafting/start',  idempotencyCheck, idempotencyCapture, craftingHandler);
 *   router.post('/inventory',       idempotencyCheck, idempotencyCapture, inventoryHandler);
 *
 * Notes:
 *  - Idempotency keys are scoped per-user (grudge_id) so key collisions across
 *    users are impossible.
 *  - Only 2xx responses are cached. Errors are never replayed.
 *  - Falls through gracefully if Redis is unavailable — requests still succeed,
 *    just without deduplication.
 */

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Create the idempotency middleware pair.
 *
 * @param {Function} getRedis
 *   Zero-argument function that returns a ioredis / node-redis client instance.
 *   Called lazily so it's safe to pass before Redis is connected.
 * @param {object} [options]
 * @param {number} [options.ttlSeconds=86400]  Key expiry in Redis (default 24 h).
 * @param {string} [options.prefix='idem:']    Redis key prefix.
 *
 * @returns {{ idempotencyCheck: Function, idempotencyCapture: Function }}
 */
function makeIdempotency(getRedis, options = {}) {
  const ttl    = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const prefix = options.prefix     ?? 'idem:';

  // ── Build the scoped Redis key ─────────────────────────────────────────────
  function buildKey(req) {
    const clientKey = req.headers['x-idempotency-key'];
    if (!clientKey) return null;
    // Scope to the authenticated user (req.user set by requireAuth).
    // Internal calls are scoped to 'internal' so they can also benefit.
    const userId = req.user?.grudge_id || (req.isInternal ? 'internal' : 'anon');
    return `${prefix}${userId}:${clientKey}`;
  }

  // ── Step 1: Check for a cached response ───────────────────────────────────

  /**
   * idempotencyCheck
   *
   * Must come BEFORE your handler. If a cached response exists for this key
   * it is returned immediately and the handler is never invoked.
   */
  async function idempotencyCheck(req, res, next) {
    const key = buildKey(req);
    if (!key) return next();

    let redis;
    try { redis = getRedis(); } catch { return next(); }
    if (!redis) return next();

    try {
      const cached = await redis.get(key);
      if (cached) {
        const { status, body } = JSON.parse(cached);
        res.setHeader('X-Idempotency-Replay', 'true');
        return res.status(status).json(body);
      }
    } catch (err) {
      // Redis hiccup — log and fall through; never block the request
      console.warn('[idempotency] Redis read error:', err.message);
    }
    return next();
  }

  // ── Step 2: Capture the response and cache it ─────────────────────────────

  /**
   * idempotencyCapture
   *
   * Must come AFTER idempotencyCheck and BEFORE your handler.
   * Wraps res.json to capture and store successful responses in Redis.
   */
  function idempotencyCapture(req, res, next) {
    const key = buildKey(req);
    if (!key) return next();

    let redis;
    try { redis = getRedis(); } catch { return next(); }
    if (!redis) return next();

    const origJson = res.json.bind(res);

    res.json = function captureAndForward(body) {
      // Only cache success responses — never cache errors
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const payload = JSON.stringify({ status: res.statusCode, body });
        redis
          .set(key, payload, 'EX', ttl)
          .catch(err => console.warn('[idempotency] Redis write error:', err.message));
      }
      return origJson(body);
    };

    return next();
  }

  return { idempotencyCheck, idempotencyCapture };
}

module.exports = { makeIdempotency };
