const { getMessages } = require("../lib/redis");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const today = new Date().toISOString().split("T")[0];

  // Gather all messages from today
  const whatsappMessages = await getMessages("whatsapp", today);

  if (whatsappMessages.length === 0) {
    await postMessage(
      process.env.BOT1_TOKEN,
      process.env.SLACK_CHANNEL_ID,
      `📊 *Daily Summary (${today})*\n\nGeen WhatsApp berichten ontvangen vandaag.`
    );
    return res.status(200).json({ status: "ok", messages: 0 });
  }

  // Build summary prompt
  const whatsappSummary = whatsappMessages
    .map((m) => `[${m.timestamp}] ${m.name} (${m.from}): ${m.text}`)
    .join("\n");

  const prompt = `Here are all WhatsApp messages received today (${today}):\n\n${whatsappSummary}\n\nPlease provide a concise daily summary in Dutch. Include:
1. Total messages received
2. Key messages that need attention or action
3. Any tasks or to-dos mentioned
4. People who reached out

Format it nicely for Slack with bold headers and bullet points.`;

  const summary = await askClaude(
    "You are a personal assistant summarizing daily communications. Be concise and actionable. Respond in Dutch.",
    prompt,
    false
  );

  await postMessage(
    process.env.BOT1_TOKEN,
    process.env.SLACK_CHANNEL_ID,
    `📊 *Daily Summary (${today})*\n\n${summary}`
  );

  return res.status(200).json({ status: "ok", messages: whatsappMessages.length });
};
