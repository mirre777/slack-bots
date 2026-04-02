const { verifySlackSignature, postMessage, postReply, getBotUserId, getThreadReplies, addReaction, removeReaction } = require("./slack");
const { askClaude } = require("./claude");

const MAX_BOT_REPLIES_PER_THREAD = 2;
const MAX_HISTORY_MESSAGES = 20;

async function buildConversation(botToken, ownBotUserId, event) {
  const messages = [];

  try {
    let slackMessages = [];

    if (event.thread_ts) {
      // Thread: get all replies
      const replies = await getThreadReplies(botToken, event.channel, event.thread_ts);
      slackMessages = replies;
    } else {
      // Channel: get recent history
      const res = await fetch(
        `https://slack.com/api/conversations.history?channel=${event.channel}&limit=${MAX_HISTORY_MESSAGES}`,
        { headers: { Authorization: `Bearer ${botToken}` } }
      );
      const data = await res.json();
      slackMessages = (data.messages || []).reverse();
    }

    // Convert Slack messages to Claude message format
    for (const msg of slackMessages) {
      if (!msg.text || msg.subtype === "channel_join") continue;

      const role = msg.user === ownBotUserId ? "assistant" : "user";
      messages.push({ role, content: msg.text });
    }

    // Claude requires messages to start with "user" and alternate roles
    // Merge consecutive same-role messages
    const merged = [];
    for (const msg of messages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += "\n" + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    // Ensure first message is from user
    if (merged.length > 0 && merged[0].role === "assistant") {
      merged.shift();
    }

    // Ensure last message is from user
    if (merged.length > 0 && merged[merged.length - 1].role !== "user") {
      merged.push({ role: "user", content: "(waiting for your response)" });
    }

    if (merged.length > 0) return merged;
  } catch (err) {
    console.error("Failed to build conversation:", err.message);
  }

  // Fallback: just the current message
  return [{ role: "user", content: event.text }];
}

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
      // Show eyes reaction so user knows we're processing
      await addReaction(botToken, event.channel, event.ts, "eyes").catch(() => {});

      // Build conversation history from Slack
      const messages = await buildConversation(botToken, ownBotUserId, event);

      console.log("Processing message:", event.text, `(${messages.length} messages in context)`);
      const reply = await askClaude(systemPrompt, messages, useTools);

      // Remove eyes, add checkmark
      await removeReaction(botToken, event.channel, event.ts, "eyes").catch(() => {});
      await addReaction(botToken, event.channel, event.ts, "white_check_mark").catch(() => {});

      // Reply in thread if it's a thread or bot-to-bot, otherwise top-level
      if (event.thread_ts || event.bot_id) {
        await postReply(botToken, event.channel, threadTs, reply);
      } else {
        await postMessage(botToken, event.channel, reply);
      }
      console.log("Reply sent successfully");
    } catch (err) {
      console.error("Bot error:", err);
      // Remove eyes on error
      await removeReaction(botToken, event.channel, event.ts, "eyes").catch(() => {});
    }

    return res.status(200).end();
  };
}

module.exports = { createBotHandler };