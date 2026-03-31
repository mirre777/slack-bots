const { createBotHandler } = require("../lib/handler");

module.exports = createBotHandler({
  signingSecret: process.env.BOT2_SIGNING_SECRET,
  botToken: process.env.BOT2_TOKEN,
  systemPrompt: "You are Bot 2, a helpful assistant. Be concise and friendly.",
});
