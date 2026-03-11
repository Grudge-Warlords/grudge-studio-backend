const Redis = require('ioredis');
let client;

async function initRedis() {
  // REDIS_URL includes password: redis://:password@host:port
  client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
  });
  await client.connect();
  console.log('[game-api] Redis connected');
}

function getRedis() {
  if (!client) throw new Error('Redis not initialized');
  return client;
}

module.exports = { initRedis, getRedis };
