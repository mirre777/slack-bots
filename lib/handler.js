const { verifySlackSignature, postMessage, postReply, getBotUserId, getThreadReplies } = require("./slack");
const { askClaude } = require("./claude");

const MAX_BOT_REPLIES_PER_THREAD = 2;

function createBotHandler({ signingSecret, botToken, systemPrompt, useTools = false }) {
  let ownBotUserId = null;

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

    // Verify Slack signature
    if (!verifySlackSignature(req, rawBody, signingSecret)) {
      console.error("Slack signature verification failed", {
        hasSignature: !!req.headers["x-slack-signature"],
        hasTimestamp: !!req.headers["x-slack-request-timestamp"],
        hasSigningSecret: !!signingSecret,
        signingSecretLength: signingSecret?.length,
        bodyLength: rawBody.length,
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

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

    // Ignore Slack retries (prevents duplicate processing)
    if (req.headers["x-slack-retry-num"]) {
      return res.status(200).end();
    }

    // Ignore non-message events
    const event = body.event;
    if (!event || event.type !== "message") {
      return res.status(200).end();
    }

    // Get own bot user ID (cached after first call)
    if (!ownBotUserId) {
      ownBotUserId = await getBotUserId(botToken);
    }

    // Ignore own messages (prevents self-reply loops)
    if (event.user === ownBotUserId) {
      return res.status(200).end();
    }

    // Loop protection: check how many times THIS bot already replied in the thread
    const threadTs = event.thread_ts || event.ts;
    if (event.bot_id) {
      try {
        const replies = await getThreadReplies(botToken, event.channel, threadTs);
        const ownReplies = replies.filter((m) => m.user === ownBotUserId);
        if (ownReplies.length >= MAX_BOT_REPLIES_PER_THREAD) {
          console.log(`Loop protection: already replied ${ownReplies.length} times in thread`);
          return res.status(200).end();
        }
      } catch (err) {
        console.error("Thread check failed:", err.message);
      }
    }

    // Process message
    try {
      const senderContext = event.bot_id ? "(message from another assistant)" : "";
      const messageText = `${senderContext} ${event.text}`.trim();

      console.log("Processing message:", messageText);
      const reply = await askClaude(systemPrompt, messageText, useTools);

      // Reply in thread if it's a thread or bot-to-bot, otherwise top-level
      if (event.thread_ts || event.bot_id) {
        await postReply(botToken, event.channel, threadTs, reply);
      } else {
        await postMessage(botToken, event.channel, reply);
      }
      console.log("Reply sent successfully");
    } catch (err) {
      console.error("Bot error:", err);
    }

    return res.status(200).end();
  };
}

module.exports = { createBotHandler };