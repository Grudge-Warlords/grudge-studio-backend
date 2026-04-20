const Redis = require('ioredis');
let client;
let connected = false;

async function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[game-api] REDIS_URL not set — running without Redis');
    return;
  }
  try {
    client = new Redis(url, {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        if (times > 20) return null; // stop retrying after 20 attempts
        return Math.min(times * 500, 10000);
      },
      reconnectOnError(err) {
        return err.message.includes('READONLY') ? 2 : false;
      },
    });
    client.on('connect', () => { connected = true; console.log('[game-api] Redis connected'); });
    client.on('error', (err) => { connected = false; console.warn('[game-api] Redis error:', err.message); });
    client.on('close', () => { connected = false; });
    // Don't await — let app start without Redis
    console.log('[game-api] Redis connecting to', url.replace(/:[^:@]+@/, ':***@'));
  } catch (err) {
    console.warn('[game-api] Redis init failed:', err.message, '— running without cache');
  }
}

function getRedis() {
  return client && connected ? client : null;
}

function isRedisReady() {
  return connected;
}

module.exports = { initRedis, getRedis, isRedisReady };
