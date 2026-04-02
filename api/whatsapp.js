const { storeMessage } = require("../lib/redis");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  // Twilio sends form-encoded data
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString();
  const params = new URLSearchParams(rawBody);

  const from = params.get("From") || "";
  const body = params.get("Body") || "";
  const profileName = params.get("ProfileName") || from;

  if (!body) {
    return res.status(200).end();
  }

  // Store in Redis
  await storeMessage("whatsapp", {
    from: from.replace("whatsapp:", ""),
    name: profileName,
    text: body,
  });

  // Forward to Slack
  const slackMessage = `📱 *WhatsApp van ${profileName}* (${from.replace("whatsapp:", "")})\n>${body}`;
  await postMessage(process.env.BOT1_TOKEN, process.env.SLACK_CHANNEL_ID, slackMessage);

  // Respond with empty TwiML (don't auto-reply)
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send("<Response></Response>");
};

module.exports.config = {
  api: { bodyParser: false },
};
