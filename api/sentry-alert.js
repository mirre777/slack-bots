const crypto = require("crypto");
const { waitUntil } = require("@vercel/functions");

function verifySignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function formatIssue(action, issue, project) {
  const level = issue.level || "error";
  const emoji = level === "fatal" ? ":fire:" : level === "warning" ? ":warning:" : ":rotating_light:";
  const projectSlug = project?.slug || issue.project?.slug || "unknown";
  const env = issue.metadata?.environment || issue.environment || "production";
  const title = issue.title || issue.metadata?.value || "Untitled Sentry issue";
  const shortId = issue.shortId || issue.short_id || "";
  const culprit = issue.culprit || "";
  const count = issue.count || issue.events?.length || "?";
  const permalink = issue.permalink || issue.web_url || "";
  const actionLabel =
    action === "created" ? "New issue" :
    action === "resolved" ? "Resolved" :
    action === "reopened" ? "Reopened" :
    action === "assigned" ? "Assigned" :
    action.charAt(0).toUpperCase() + action.slice(1);

  const header = `${emoji} *${actionLabel}* in \`${projectSlug}\` (${env})`;
  const titleLine = shortId ? `*${shortId}* — ${title}` : `*${title}*`;
  const culpritLine = culprit ? `\`${culprit}\`` : null;
  const countLine = action === "created" ? null : `Seen ${count}×`;
  const link = permalink ? `<${permalink}|Open in Sentry>` : null;

  return [header, titleLine, culpritLine, countLine, link].filter(Boolean).join("\n");
}

async function postToSlack(channel, text) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BOT1_TOKEN}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json();
  if (!data.ok) console.error("Slack post failed:", data);
  return data;
}

async function processAsync(body) {
  try {
    const action = body.action || "triggered";
    const data = body.data || {};
    const issue = data.issue || data.event || {};
    const project = issue.project || data.project || {};
    const text = formatIssue(action, issue, project);
    await postToSlack(process.env.OPS_SLACK_CHANNEL_ID, text);
  } catch (err) {
    console.error("sentry-alert async failed:", err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  const sig = req.headers["sentry-hook-signature"];
  const secret = process.env.SENTRY_CLIENT_SECRET;
  if (secret) {
    if (!verifySignature(rawBody, sig, secret)) {
      console.error("Sentry signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }
  } else if (!sig) {
    console.warn("sentry-alert: no SENTRY_CLIENT_SECRET set and no signature header — accepting (test mode)");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  waitUntil(processAsync(body));
  return res.status(200).json({ ok: true });
};

module.exports.config = { api: { bodyParser: false } };
