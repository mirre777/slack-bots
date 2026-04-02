const REDIS_URL = process.env.KV_REDIS_URL;

async function redisRequest(command, args = []) {
  const url = `${REDIS_URL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  return data.result;
}

function todayKey(prefix) {
  const date = new Date().toISOString().split("T")[0];
  return `${prefix}:${date}`;
}

async function storeMessage(type, message) {
  const key = todayKey(type);
  const entry = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString(),
  });
  await redisRequest("RPUSH", [key, entry]);
  // Expire after 7 days
  await redisRequest("EXPIRE", [key, 604800]);
}

async function getMessages(type, date) {
  const key = `${type}:${date || new Date().toISOString().split("T")[0]}`;
  const messages = await redisRequest("LRANGE", [key, "0", "-1"]);
  return (messages || []).map((m) => JSON.parse(m));
}

module.exports = { storeMessage, getMessages, redisRequest };
