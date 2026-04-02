const { getBalances, getTransactions } = require("../lib/tools/wise");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const [balances, transactions] = await Promise.all([
    getBalances().catch(() => "Could not fetch balances."),
    getTransactions({ limit: 20 }).catch(() => "Could not fetch transactions."),
  ]);

  const today = new Date().toISOString().split("T")[0];

  const prompt = `Here is my Wise financial data for ${today}:

💰 BALANCES:
${balances}

📊 RECENT TRANSACTIONS (last 30 days):
${transactions}

Create a concise daily finance summary in Dutch. Structure it as:
1. 💰 Balansen — current balance per currency
2. 📊 Vandaag/gisteren — transactions from today and yesterday, if any
3. 📈 Samenvatting — total in/out this week, any notable patterns
4. ⚠️ Let op — large transactions, unusual activity, or low balances

Keep it scannable for Slack. Use bold, bullets, and emoji. Be concise.`;

  const summary = await askClaude(
    "You are a personal finance assistant. Summarize financial data concisely in Dutch. Highlight anything that needs attention.",
    prompt,
    false
  );

  await postMessage(
    process.env.BOT1_TOKEN,
    process.env.SLACK_CHANNEL_ID,
    `💰 *Finance Daily — ${today}*\n\n${summary}`
  );

  return res.status(200).json({ status: "ok" });
};
