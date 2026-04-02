const { listEmails } = require("../lib/tools/gmail");
const { createTask } = require("../lib/tools/todoist");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  // Get unread emails from today
  const emails = await listEmails({ maxResults: 20, query: "is:unread newer_than:1d" });

  if (emails === "No emails found.") {
    return res.status(200).json({ status: "ok", tasks: 0 });
  }

  // Ask Claude to extract actionable tasks
  const prompt = `Analyze these emails and extract any actionable tasks, deadlines, or to-dos. Only extract real action items, not newsletters or spam.

Emails:
${emails}

For each task found, respond ONLY with a JSON array. Each item should have:
- "content": task title (concise, actionable)
- "due_string": deadline if mentioned (e.g. "tomorrow", "april 15"), or null
- "priority": 1-4 (4=urgent, 3=high, 2=medium, 1=normal)
- "source": who sent the email

If no actionable tasks found, respond with an empty array: []

Respond ONLY with the JSON array, no other text.`;

  const result = await askClaude(
    "You extract actionable tasks from emails. Be concise and accurate. Only return JSON.",
    prompt,
    false
  );

  let tasks;
  try {
    tasks = JSON.parse(result);
  } catch {
    console.error("Failed to parse tasks:", result);
    return res.status(200).json({ status: "ok", tasks: 0, error: "parse_failed" });
  }

  if (!tasks.length) {
    return res.status(200).json({ status: "ok", tasks: 0 });
  }

  // Create tasks in Todoist
  const created = [];
  for (const task of tasks) {
    try {
      const result = await createTask({
        content: task.content,
        description: `Source: ${task.source || "email"}`,
        due_string: task.due_string || undefined,
        priority: task.priority || 1,
      });
      created.push(task.content);
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  // Notify in Slack
  if (created.length > 0) {
    const taskList = created.map((t) => `• ${t}`).join("\n");
    await postMessage(
      process.env.BOT1_TOKEN,
      process.env.SLACK_CHANNEL_ID,
      `📧 *Email Scan Complete*\n\n${created.length} taken aangemaakt in Todoist:\n${taskList}`
    );
  }

  return res.status(200).json({ status: "ok", tasks: created.length });
};
