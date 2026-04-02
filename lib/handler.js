const { postMessage } = require("./slack");
const { askClaude } = require("./claude");

function createBotHandler({ signingSecret, botToken, systemPrompt, useTools = false }) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Read raw body from stream (body parsing is disabled via vercel.json)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString();

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

    // Ignore non-message events or bot messages
    const event = body.event;
    if (!event || event.type !== "message" || event.bot_id) {
      return res.status(200).end();
    }

    // Process BEFORE responding (Vercel kills function after res.end())
    try {
      console.log("Processing message:", event.text);
      const reply = await askClaude(systemPrompt, event.text, useTools);
      await postMessage(botToken, event.channel, reply);
      console.log("Reply sent successfully");
    } catch (err) {
      console.error("Bot error:", err);
    }

    return res.status(200).end();
  };
}

module.exports = { createBotHandler };
