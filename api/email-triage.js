const { listEmailsRaw, starMessage, archiveMessage } = require("../lib/tools/gmail");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const emails = await listEmailsRaw({ maxResults: 20, query: "is:unread newer_than:1d" });

  if (!emails.length) {
    return res.status(200).json({ status: "ok", triaged: 0 });
  }

  // Format emails for Claude, include index so we can map back to IDs
  const emailList = emails
    .map((e, i) => `[${i}] Subject: ${e.subject}\nFrom: ${e.from}\nDate: ${e.date}\n${e.snippet}`)
    .join("\n\n---\n\n");

  const prompt = `Categorize these unread emails into exactly 4 categories. Respond ONLY with JSON, no other text.

Emails:
${emailList}

Return a JSON object with these keys:
- "urgent": emails needing immediate attention (deadlines, important people, time-sensitive)
- "action": emails that need a response or action but aren't urgent
- "later": informational emails, newsletters worth reading later
- "spam": marketing, promotions, irrelevant notifications

Each category is an array of objects with:
- "index": the [N] number from the email list
- "subject": email subject
- "from": sender
- "reason": why it's in this category (1 short sentence in Dutch)

Respond ONLY with the JSON object.`;

  const result = await askClaude(
    "You triage emails precisely. Only return valid JSON. Categorize based on sender importance, urgency signals, and content type.",
    prompt,
    false
  );

  let triage;
  try {
    triage = JSON.parse(result);
  } catch {
    console.error("Failed to parse triage:", result);
    return res.status(200).json({ status: "ok", error: "parse_failed" });
  }

  // Star urgent emails
  let starred = 0;
  for (const item of triage.urgent || []) {
    const email = emails[item.index];
    if (email) {
      try {
        await starMessage(email.id);
        starred++;
      } catch (err) {
        console.error("Failed to star:", email.id, err.message);
      }
    }
  }

  // Archive spam emails
  let archived = 0;
  for (const item of triage.spam || []) {
    const email = emails[item.index];
    if (email) {
      try {
        await archiveMessage(email.id);
        archived++;
      } catch (err) {
        console.error("Failed to archive:", email.id, err.message);
      }
    }
  }

  // Build Slack message
  const sections = [];

  if (triage.urgent?.length) {
    sections.push(`🔴 *URGENT* (${triage.urgent.length}) ⭐ gestarred\n${formatCategory(triage.urgent)}`);
  }
  if (triage.action?.length) {
    sections.push(`🟡 *ACTIE NODIG* (${triage.action.length})\n${formatCategory(triage.action)}`);
  }
  if (triage.later?.length) {
    sections.push(`🔵 *LATER LEZEN* (${triage.later.length})\n${formatCategory(triage.later)}`);
  }
  if (triage.spam?.length) {
    sections.push(`⚪ *SPAM/SKIP* (${triage.spam.length}) 🗑️ gearchiveerd\n${formatCategory(triage.spam)}`);
  }

  const total = (triage.urgent?.length || 0) + (triage.action?.length || 0) +
    (triage.later?.length || 0) + (triage.spam?.length || 0);

  const actions = [];
  if (starred) actions.push(`⭐ ${starred} urgent gestarred`);
  if (archived) actions.push(`🗑️ ${archived} spam gearchiveerd`);
  const actionLine = actions.length ? `\n\n_${actions.join(" · ")}_` : "";

  const message = `📬 *Email Triage* — ${total} emails gecategoriseerd${actionLine}\n\n${sections.join("\n\n")}`;

  await postMessage(process.env.BOT1_TOKEN, process.env.SLACK_CHANNEL_ID, message);

  return res.status(200).json({ status: "ok", triaged: total, starred, archived });
};

function formatCategory(items) {
  return items
    .map((e) => `• *${e.subject}* — ${e.from}\n   _${e.reason}_`)
    .join("\n");
}
