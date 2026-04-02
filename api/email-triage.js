const { listEmailsRaw, starMessage, archiveMessage } = require("../lib/tools/gmail");
const { createTask } = require("../lib/tools/todoist");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const emails = await listEmailsRaw({ maxResults: 20, query: "is:unread newer_than:1d" });

  if (!emails.length) {
    return res.status(200).json({ status: "ok", triaged: 0, tasks: 0 });
  }

  // Format emails for Claude, include index so we can map back to IDs
  const emailList = emails
    .map((e, i) => `[${i}] Subject: ${e.subject}\nFrom: ${e.from}\nDate: ${e.date}\n${e.snippet}`)
    .join("\n\n---\n\n");

  // Step 1+2: Triage AND extract tasks in one Claude call
  const prompt = `Analyze these unread emails. Do two things:

Emails:
${emailList}

Return a JSON object with TWO keys: "triage" and "tasks".

**triage**: categorize every email into exactly 4 categories:
- "urgent": needs immediate attention (deadlines, important people, time-sensitive)
- "action": needs a response or action but not urgent
- "later": informational, newsletters worth reading later
- "spam": marketing, promotions, irrelevant notifications

Each triage item: { "index": N, "subject": "...", "from": "...", "reason": "..." (Dutch) }

**tasks**: extract actionable to-dos ONLY from urgent and action emails. Skip newsletters, spam, and purely informational emails.
Each task: { "content": "task title (concise, actionable)", "due_string": "deadline or null", "priority": 1-4 (4=urgent), "source": "sender name" }

If no tasks found, return empty array.
Respond ONLY with the JSON object, no other text.`;

  const result = await askClaude(
    "You triage emails and extract tasks precisely. Only return valid JSON. Be concise and actionable.",
    prompt,
    false
  );

  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    console.error("Failed to parse:", result);
    return res.status(200).json({ status: "ok", error: "parse_failed" });
  }

  const triage = parsed.triage || {};
  const tasks = parsed.tasks || [];

  // Step 3: Star urgent, archive spam
  let starred = 0;
  for (const item of triage.urgent || []) {
    const email = emails[item.index];
    if (email) {
      try { await starMessage(email.id); starred++; }
      catch (err) { console.error("Star failed:", email.id, err.message); }
    }
  }

  let archived = 0;
  for (const item of triage.spam || []) {
    const email = emails[item.index];
    if (email) {
      try { await archiveMessage(email.id); archived++; }
      catch (err) { console.error("Archive failed:", email.id, err.message); }
    }
  }

  // Step 4: Create tasks in Todoist
  const created = [];
  for (const task of tasks) {
    try {
      await createTask({
        content: task.content,
        description: `Source: ${task.source || "email"}`,
        due_string: task.due_string || undefined,
        priority: task.priority || 1,
      });
      created.push(task.content);
    } catch (err) {
      console.error("Task failed:", err.message);
    }
  }

  // Step 5: Post everything to Slack
  const sections = [];

  if (triage.urgent?.length) {
    sections.push(`*Urgent* (${triage.urgent.length}) — gestarred\n${formatCategory(triage.urgent)}`);
  }
  if (triage.action?.length) {
    sections.push(`*Actie nodig* (${triage.action.length})\n${formatCategory(triage.action)}`);
  }
  if (triage.later?.length) {
    sections.push(`*Later lezen* (${triage.later.length})\n${formatCategory(triage.later)}`);
  }
  if (triage.spam?.length) {
    sections.push(`*Spam/skip* (${triage.spam.length}) — gearchiveerd\n${formatCategory(triage.spam)}`);
  }

  const total = (triage.urgent?.length || 0) + (triage.action?.length || 0) +
    (triage.later?.length || 0) + (triage.spam?.length || 0);

  const actions = [];
  if (starred) actions.push(`${starred} gestarred`);
  if (archived) actions.push(`${archived} gearchiveerd`);
  if (created.length) actions.push(`${created.length} taken → Todoist`);
  const actionLine = actions.length ? `\n_${actions.join(" · ")}_` : "";

  let taskSection = "";
  if (created.length) {
    taskSection = `\n\n*Taken aangemaakt in Todoist:*\n${created.map((t) => `• ${t}`).join("\n")}`;
  }

  const message = `:mailbox_with_mail: *Email Triage* — ${total} emails verwerkt${actionLine}\n\n${sections.join("\n\n")}${taskSection}`;

  await postMessage(process.env.BOT1_TOKEN, process.env.SLACK_CHANNEL_ID, message);

  return res.status(200).json({ status: "ok", triaged: total, starred, archived, tasks: created.length });
};

function formatCategory(items) {
  return items
    .map((e) => `• *${e.subject}* — ${e.from}\n   _${e.reason}_`)
    .join("\n");
}
