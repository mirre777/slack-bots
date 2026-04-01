const { createBotHandler } = require("../lib/handler");

const handler = createBotHandler({
  signingSecret: process.env.BOT1_SIGNING_SECRET,
  botToken: process.env.BOT1_TOKEN,
  systemPrompt: "You are Bot 1, a helpful assistant. Be concise and friendly.",
});

module.exports = handler;

module.exports.config = {
  api: { bodyParser: false },
};
