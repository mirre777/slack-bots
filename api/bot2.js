const { createBotHandler } = require("../lib/handler");

const handler = createBotHandler({
  signingSecret: process.env.BOT2_SIGNING_SECRET,
  botToken: process.env.BOT2_TOKEN,
  systemPrompt: "You are Bot 2, a helpful assistant. Be concise and friendly.",
});

module.exports = handler;

module.exports.config = {
  api: { bodyParser: false },
};
