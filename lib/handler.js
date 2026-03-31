const { verifySlackSignature, postMessage } = require("./slack");
const { askClaude } = require("./claude");

function createBotHandler({ signingSecret, botToken, systemPrompt }) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Collect raw body for signature verification
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString();
    req.rawBody = rawBody;

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // Slack URL verification challenge
    if (body.type === "url_verification") {
      return res.status(200).json({ challenge: body.challenge });
    }

    // Verify Slack signature
    if (!verifySlackSignature(req, signingSecret)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Acknowledge Slack immediately (must respond within 3s)
    res.status(200).end();

    // Process event asynchronously
    const event = body.event;
    if (!event || event.type !== "message" || event.bot_id) return;

    try {
      const reply = await askClaude(systemPrompt, event.text);
      await postMessage(botToken, event.channel, reply);
    } catch (err) {
      console.error("Bot error:", err);
    }
  };
}

module.exports = { createBotHandler };
