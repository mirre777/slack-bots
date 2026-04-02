const crypto = require("crypto");

function verifySlackSignature(req, rawBody, signingSecret) {
  try {
    const signature = req.headers["x-slack-signature"];
    const timestamp = req.headers["x-slack-request-timestamp"];

    if (!signature || !timestamp || !rawBody || !signingSecret) return false;

    // Reject requests older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    const sigBase = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto
      .createHmac("sha256", signingSecret)
      .update(sigBase, "utf8")
      .digest("hex");
    const computed = `v0=${hmac}`;

    // timingSafeEqual throws if lengths differ
    if (computed.length !== signature.length) return false;

    return crypto.timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(signature, "utf8"));
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
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

async function postReply(token, channel, threadTs, text) {
  const formatted = text
    .replace(/^-{2,}$/gm, "————————————————————————————————")
    .replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text: formatted, thread_ts: threadTs }),
  });
  return res.json();
}

async function getBotUserId(token) {
  const res = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.user_id;
}

async function getThreadReplies(token, channel, threadTs) {
  const res = await fetch(
    `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.messages || [];
}

module.exports = { verifySlackSignature, postMessage, postReply, getBotUserId, getThreadReplies };
