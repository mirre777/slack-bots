const { listEvents } = require("../lib/tools/calendar");
const { listEmails } = require("../lib/tools/gmail");
const { listTasks } = require("../lib/tools/todoist");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const today = new Date().toISOString().split("T")[0];

  // Gather all data in parallel
  const [calendar, tasks, emails, weather] = await Promise.all([
    listEvents({ maxResults: 10 }).catch(() => "Could not fetch calendar."),
    listTasks({ filter: "today | overdue" }).catch(() => "Could not fetch tasks."),
    listEmails({ maxResults: 10, query: "is:unread newer_than:1d" }).catch(() => "Could not fetch emails."),
    fetchWeather().catch(() => "Could not fetch weather."),
  ]);

  const prompt = `Here is my morning data for ${today}:

📅 CALENDAR (today's events):
${calendar}

✅ TASKS (today + overdue):
${tasks}

📧 UNREAD EMAILS:
${emails}

🌤️ WEATHER:
${weather}

Create a concise morning briefing in Dutch. Structure it as:
1. Goedemorgen + weather summary (1 line)
2. 📅 Agenda vandaag — list events with times
3. ✅ Taken — list tasks, highlight overdue ones
4. 📧 Inbox — summarize important unread emails, skip newsletters/spam
5. 💡 Heads up — any conflicts, tight schedules, or things to watch out for

Keep it scannable for Slack. Use bold, bullets, and emoji. Be concise.`;

  const briefing = await askClaude(
    "You are a personal assistant creating a morning briefing. Be concise, actionable, and respond in Dutch.",
    prompt,
    false
  );

  await postMessage(
    process.env.BOT1_TOKEN,
    process.env.SLACK_CHANNEL_ID,
    `☀️ *Ochtend Briefing — ${today}*\n\n${briefing}`
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
