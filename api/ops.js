const querystring = require("querystring");
const Anthropic = require("@anthropic-ai/sdk");
const { verifySlackSignature } = require("../lib/slack");
const { getClient } = require("../lib/redis");

const KEY = "ops:errors";
const MAX_ENTRIES_TO_SUMMARIZE = 100;

function parseRange(text) {
  const t = (text || "").trim().toLowerCase();
  if (t.startsWith("deployment ")) {
    return { mode: "deployment", value: t.slice(11).trim() };
  }
  const m = t.match(/last\s+(\d+)\s*(h|m|min|hour|hours|minutes)?/);
  if (m) {
    const num = parseInt(m[1], 10);
    const unit = (m[2] || "h").charAt(0);
    const ms = unit === "h" ? num * 3600_000 : num * 60_000;
    return { mode: "since", value: Date.now() - ms, windowMin: ms / 60_000 };
  }
  return { mode: "since", value: Date.now() - 3600_000, windowMin: 60 };
}

function filterEntries(entries, range) {
  if (range.mode === "deployment") {
    return entries.filter((e) => e.deploymentId && e.deploymentId.includes(range.value));
  }
  return entries.filter((e) => e.ts >= range.value);
}

async function summarize(entries, range) {
  if (entries.length === 0) {
    return range.mode === "deployment"
      ? `No errors recorded for deployment \`${range.value}\`.`
      : `No errors in the last ${range.windowMin} min. :white_check_mark:`;
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const compact = entries.slice(0, MAX_ENTRIES_TO_SUMMARIZE).map((e) => ({
    ts: new Date(e.ts).toISOString(),
    path: e.path,
    deploymentId: e.deploymentId,
    status: e.statusCode,
    requestId: e.requestId,
    msg: (e.msg || "").slice(0, 400),
  }));
  const prompt = `You are an SRE assistant for a Next.js app on Vercel. Summarize these production errors.

${JSON.stringify(compact, null, 2)}

Respond in Slack mrkdwn. Use *bold* (single star, not double). No headers, no horizontal rules.

Structure:
- Lead with one line: count, time range, most-common endpoint
- Group by deployment ID + root cause
- For each cluster: count, affected paths, one sample message (truncated)
- If one deployment is responsible for most errors, call it out explicitly and suggest rollback
- End with one recommended next action

Be terse. Bullet points. No filler.`;

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((b) => b.type === "text");
  return text ? text.text : "Claude returned no text.";
}

async function processAsync(responseUrl, text) {
  try {
    const range = parseRange(text);
    const redis = getClient();
    await redis.connect().catch(() => {});
    const raw = await redis.lrange(KEY, 0, 499);
    const entries = raw.map((s) => JSON.parse(s));
    const filtered = filterEntries(entries, range);
    const summary = await summarize(filtered, range);

    const header = range.mode === "deployment"
      ? `*Ops report* — deployment \`${range.value}\` — ${filtered.length} errors`
      : `*Ops report* — last ${range.windowMin} min — ${filtered.length} errors`;

    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "in_channel",
        text: `${header}\n${summary}`,
      }),
    });
  } catch (err) {
    console.error("ops async failed:", err);
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: `Failed to generate ops report: ${err.message}`,
      }),
    }).catch(() => {});
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  if (!verifySlackSignature(req, rawBody, process.env.BOT1_SIGNING_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const params = querystring.parse(rawBody);
  const responseUrl = params.response_url;
  const text = params.text || "";

  const ackText = text
    ? `:hourglass_flowing_sand: Checking ops (\`${text}\`)…`
    : `:hourglass_flowing_sand: Checking ops (last 1h)…`;

  res.status(200).json({ response_type: "in_channel", text: ackText });

  await processAsync(responseUrl, text);
};

module.exports.config = { api: { bodyParser: false } };
