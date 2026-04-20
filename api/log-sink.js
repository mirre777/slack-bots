const crypto = require("crypto");
const { getClient } = require("../lib/redis");

const MAX_ERRORS = 500;
const KEY = "ops:errors";

function verifySignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parsePayload(rawBody, contentType) {
  if (contentType && contentType.includes("ndjson")) {
    return rawBody
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(rawBody);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isError(entry) {
  const level = entry.level || "";
  if (level === "error" || level === "fatal") return true;
  const status = entry.proxy?.statusCode ?? entry.statusCode;
  if (typeof status === "number" && status >= 500) return true;
  return false;
}

function compactEntry(entry) {
  return {
    ts: entry.timestamp || Date.now(),
    level: entry.level || (isError(entry) ? "error" : "info"),
    msg: (entry.message || entry.text || "").slice(0, 2000),
    deploymentId: entry.deploymentId || null,
    environment: entry.environment || null,
    requestId: entry.requestId || entry.proxy?.requestId || null,
    path: entry.path || entry.proxy?.path || null,
    region: entry.region || null,
    statusCode: entry.statusCode || entry.proxy?.statusCode || null,
    source: entry.source || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  if (!verifySignature(rawBody, req.headers["x-vercel-signature"], process.env.LOG_SINK_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let entries;
  try {
    entries = parsePayload(rawBody, req.headers["content-type"]);
  } catch (err) {
    console.error("Failed to parse log drain payload:", err.message);
    return res.status(400).json({ error: "Invalid payload" });
  }

  const errors = entries.filter(isError).map(compactEntry);
  if (errors.length === 0) return res.status(200).json({ stored: 0 });

  try {
    const redis = getClient();
    await redis.connect().catch(() => {});
    const pipeline = redis.pipeline();
    for (const e of errors) pipeline.lpush(KEY, JSON.stringify(e));
    pipeline.ltrim(KEY, 0, MAX_ERRORS - 1);
    await pipeline.exec();
  } catch (err) {
    console.error("Redis write failed:", err.message);
    return res.status(500).json({ error: "Storage failed" });
  }

  return res.status(200).json({ stored: errors.length });
};

module.exports.config = { api: { bodyParser: false } };
