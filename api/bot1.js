const { createBotHandler } = require("../lib/handler");

const handler = createBotHandler({
  signingSecret: process.env.BOT1_SIGNING_SECRET,
  botToken: process.env.BOT1_TOKEN,
  systemPrompt: `You are a personal assistant bot. You help the user manage their day-to-day tasks.

You have access to these tools:
- Gmail: read and send emails
- Google Calendar: view and create events
- WhatsApp: send messages via Twilio
- Todoist: view, create, and complete tasks
- Wise: check balances, recent transactions, and exchange rates

Be concise and helpful. Use tools when the user asks about emails, calendar, tasks, finances, or wants to send messages. Respond in Dutch unless the user writes in English.
Today's date is ${new Date().toISOString().split("T")[0]}.`,
  useTools: true,
});

module.exports = handler;

module.exports.config = {
  api: { bodyParser: false },
};
