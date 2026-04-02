module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const channel = process.env.SLACK_CHANNEL_ID;
  const botToken = process.env.BOT1_TOKEN;

  // Get all messages from today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let deleted = 0;
  let cursor;

  do {
    const params = new URLSearchParams({
      channel,
      oldest: (startOfDay.getTime() / 1000).toString(),
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const histRes = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = await histRes.json();

    if (!data.ok || !data.messages?.length) break;

    // Delete only bot messages
    for (const msg of data.messages) {
      if (msg.bot_id || msg.subtype === "bot_message") {
        try {
          await fetch("https://slack.com/api/chat.delete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${botToken}`,
            },
            body: JSON.stringify({ channel, ts: msg.ts }),
          });
          deleted++;
          // Slack rate limit: ~1 delete per second
          await new Promise((r) => setTimeout(r, 1100));
        } catch (err) {
          console.error("Delete failed:", msg.ts, err.message);
        }
      }
    }

    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`Cleared ${deleted} bot messages`);
  return res.status(200).json({ status: "ok", deleted });
};
