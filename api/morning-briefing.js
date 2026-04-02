const { listEvents } = require("../lib/tools/calendar");
const { listEmailsRaw, starMessage, archiveMessage } = require("../lib/tools/gmail");
const { listTasks, createTask } = require("../lib/tools/todoist");
const { getBalances, getTransactions } = require("../lib/tools/wise");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const today = new Date().toISOString().split("T")[0];

  // Gather ALL data in parallel
  const [calendarToday, calendarNext3, tasks, emails, weather, balances, transactions] = await Promise.all([
    listEvents({ maxResults: 10 }).catch(() => "Could not fetch calendar."),
    listEvents({ maxResults: 20, timeMin: new Date().toISOString() }).catch(() => "Could not fetch upcoming events."),
    listTasks({ filter: "today | overdue" }).catch(() => "Could not fetch tasks."),
    listEmailsRaw({ maxResults: 20, query: "is:unread newer_than:1d" }).catch(() => []),
    fetchWeather().catch(() => "Could not fetch weather."),
    getBalances().catch(() => "Could not fetch balances."),
    getTransactions({ limit: 10 }).catch(() => "Could not fetch transactions."),
  ]);

  // --- EMAIL TRIAGE ---
  let triageSection = "Geen ongelezen emails.";
  let triageActions = "";

  if (emails.length) {
    const emailList = emails
      .map((e, i) => `[${i}] Subject: ${e.subject}\nFrom: ${e.from}\nDate: ${e.date}\n${e.snippet}`)
      .join("\n\n---\n\n");

    const triageResult = await askClaude(
      "You triage emails and extract tasks precisely. Only return valid JSON.",
      `Analyze these unread emails. Return a JSON object with TWO keys: "triage" and "tasks".

Emails:
${emailList}

**triage**: categorize every email into 4 categories:
- "urgent": needs immediate attention
- "action": needs response but not urgent
- "later": informational, newsletters
- "spam": marketing, promotions, irrelevant

Each item: { "index": N, "subject": "...", "from": "...", "reason": "..." (Dutch) }

**tasks**: actionable to-dos from urgent+action emails only.
Each: { "content": "task title", "due_string": "deadline or null", "priority": 1-4 (4=urgent), "source": "sender" }

Respond ONLY with JSON.`,
      false
    );

    let parsed;
    try {
      parsed = JSON.parse(triageResult);
    } catch {
      parsed = { triage: {}, tasks: [] };
    }

    const triage = parsed.triage || {};
    const newTasks = parsed.tasks || [];

    // Star urgent, archive spam
    let starred = 0;
    for (const item of triage.urgent || []) {
      const email = emails[item.index];
      if (email) {
        try { await starMessage(email.id); starred++; }
        catch (err) { console.error("Star failed:", err.message); }
      }
    }

    let archived = 0;
    for (const item of triage.spam || []) {
      const email = emails[item.index];
      if (email) {
        try { await archiveMessage(email.id); archived++; }
        catch (err) { console.error("Archive failed:", err.message); }
      }
    }

    // Create Todoist tasks
    const created = [];
    for (const task of newTasks) {
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

    // Build triage section
    const sections = [];
    if (triage.urgent?.length) sections.push(`  *Urgent* (${triage.urgent.length}): ${triage.urgent.map((e) => e.subject).join(", ")}`);
    if (triage.action?.length) sections.push(`  *Actie* (${triage.action.length}): ${triage.action.map((e) => e.subject).join(", ")}`);
    if (triage.later?.length) sections.push(`  *Later* (${triage.later.length}): ${triage.later.map((e) => e.subject).join(", ")}`);
    if (triage.spam?.length) sections.push(`  *Spam* (${triage.spam.length}) — gearchiveerd`);

    triageSection = sections.join("\n");

    const acts = [];
    if (starred) acts.push(`${starred} gestarred`);
    if (archived) acts.push(`${archived} gearchiveerd`);
    if (created.length) acts.push(`${created.length} taken → Todoist`);
    if (acts.length) triageActions = `\n  _${acts.join(" · ")}_`;
  }

  // --- BUILD ONE BIG BRIEFING ---
  const prompt = `Create ONE concise morning briefing in Dutch from this data. Date: ${today}.

🌤️ WEATHER:
${weather}

📅 CALENDAR TODAY:
${calendarToday}

📅 NEXT 3 DAYS:
${calendarNext3}

✅ TASKS (today + overdue):
${tasks}

💰 WISE BALANCES:
${balances}

📊 WISE TRANSACTIONS (last 30 days):
${transactions}

Structure it EXACTLY as:
1. Goedemorgen + weather (1 line, include temp)
2. :calendar: *Agenda vandaag* — events with times
3. :calendar: *Komende 3 dagen* — events per day (skip today)
4. :white_check_mark: *Taken* — list tasks, highlight overdue
5. :moneybag: *Financiën* — Wise balances (personal + business) + notable recent transactions
6. :bulb: *Heads up* — conflicts, tight schedules, low balances, things to watch

IMPORTANT formatting rules:
- Use ONE emoji only in section headings (as shown above). Use Slack emoji codes like :calendar: :moneybag: :bulb:
- Do NOT use any emoji in the body text under each heading. No icons, no emoji, just plain text with bold and bullets.
- Use --- between sections as dividers.
- Keep it scannable with bold and bullets. Be concise. Skip sections if no data.`;

  const briefing = await askClaude(
    "You are a personal assistant creating a comprehensive morning briefing. Be concise, actionable, respond in Dutch.",
    prompt,
    false
  );

  // Combine briefing + email triage (triage is structured data, not AI-generated)
  const emailBlock = emails.length
    ? `\n\n:mailbox_with_mail: *Email Triage* — ${emails.length} emails verwerkt${triageActions}\n${triageSection}`
    : "";

  await postMessage(
    process.env.BOT1_TOKEN,
    process.env.SLACK_CHANNEL_ID,
    `:sunny: *Ochtend Briefing — ${today}*\n\n${briefing}${emailBlock}`
  );

  return res.status(200).json({ status: "ok" });
};

async function fetchWeather() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return "No weather API key configured.";

  const city = process.env.WEATHER_CITY || "Doesburg";
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=nl`
  );
  const data = await res.json();

  if (data.cod !== 200) return `Weather API error: ${data.message}`;

  return `${data.name}: ${data.main.temp}°C, ${data.weather[0].description}. Wind: ${data.wind.speed} m/s. Hum: ${data.main.humidity}%`;
}
