const { createBotHandler } = require("../lib/handler");

module.exports = createBotHandler({
  signingSecret: process.env.BOT1_SIGNING_SECRET,
  botToken: process.env.BOT1_TOKEN,
  systemPrompt: "You are Bot 1, a helpful assistant. Be concise and friendly.",
});
