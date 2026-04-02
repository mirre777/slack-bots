const { google } = require("googleapis");

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  return oauth2Client;
}

async function listEvents({ maxResults = 5, timeMin }) {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin || new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  if (!res.data.items || res.data.items.length === 0) {
    return "No upcoming events found.";
  }

  return res.data.items
    .map((e) => {
      const start = e.start.dateTime || e.start.date;
      const end = e.end.dateTime || e.end.date;
      return `**${e.summary || "No title"}**\nWhen: ${start} → ${end}\nLocation: ${e.location || "N/A"}`;
    })
    .join("\n\n---\n\n");
}

async function createEvent({ summary, startTime, endTime, description, location }) {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary,
    description: description || "",
    location: location || "",
    start: { dateTime: startTime, timeZone: "Europe/Amsterdam" },
    end: { dateTime: endTime, timeZone: "Europe/Amsterdam" },
  };

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  return `Event created: "${summary}" on ${startTime}. Link: ${res.data.htmlLink}`;
}

module.exports = { listEvents, createEvent };
