const crypto = require("crypto");

function verifySlackSignature(req, rawBody, signingSecret) {
  const signature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  if (!signature || !timestamp || !rawBody) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBase)
    .digest("hex");
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

async function postMessage(token, channel, text) {
  // Format for Slack: longer dividers, markdown headings to bold
  const formatted = text
    .replace(/^-{2,}$/gm, "————————————————————————————————")
    .replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text: formatted }),
  });
  return res.json();
}

module.exports = { verifySlackSignature, postMessage };
