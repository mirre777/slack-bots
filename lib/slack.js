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
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  return res.json();
}

module.exports = { verifySlackSignature, postMessage };
