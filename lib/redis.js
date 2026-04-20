const Redis = require("ioredis");

let client;

function getClient() {
  if (!client) {
    client = new Redis(process.env.KV_REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }
  return client;
}

function todayKey(prefix) {
  return `${prefix}:${new Date().toISOString().split("T")[0]}`;
}

async function storeMessage(type, message) {
  const redis = getClient();
  await redis.connect().catch(() => {});
  const key = todayKey(type);
  const entry = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString(),
  });
  await redis.rpush(key, entry);
  await redis.expire(key, 604800); // 7 days
}

async function getMessages(type, date) {
  const redis = getClient();
  await redis.connect().catch(() => {});
  const key = `${type}:${date || new Date().toISOString().split("T")[0]}`;
  const messages = await redis.lrange(key, 0, -1);
  return messages.map((m) => JSON.parse(m));
}

module.exports = { getClient, storeMessage, getMessages };
