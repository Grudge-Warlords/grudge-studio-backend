"use strict";

const rateLimit = require("express-rate-limit");

/*
 * Note: Redis store (rate-limit-redis) can be wired in when REDIS_URL is
 * available.  For now we use the built-in memory store which is fine for a
 * single-instance service behind Traefik.  If you scale to multiple replicas,
 * swap to RedisStore.
 */

/** Global limiter — 200 req / min per IP */
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down" },
});

/** Auth limiter — 10 auth attempts / min per IP */
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many auth attempts — try again in a minute" },
});

module.exports = { globalLimiter, authLimiter };
