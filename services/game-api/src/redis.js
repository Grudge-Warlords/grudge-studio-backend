const Redis = require('ioredis');
let client;

async function initRedis() {
  client = new Redis(process.env.REDIS_URL, {
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  });
  await client.connect();
  console.log('[game-api] Redis connected');
}

function getRedis() {
  if (!client) throw new Error('Redis not initialized');
  return client;
}

module.exports = { initRedis, getRedis };
