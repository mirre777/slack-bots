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

async function listEmails({ maxResults = 5, query = "" }) {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query,
  });

  if (!res.data.messages) return "No emails found.";

  const emails = [];
  for (const msg of res.data.messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = detail.data.payload.headers;
    emails.push({
      from: headers.find((h) => h.name === "From")?.value || "Unknown",
      subject: headers.find((h) => h.name === "Subject")?.value || "No subject",
      date: headers.find((h) => h.name === "Date")?.value || "",
      snippet: detail.data.snippet,
    });
  }

  return emails
    .map((e) => `**${e.subject}**\nFrom: ${e.from}\nDate: ${e.date}\n${e.snippet}`)
    .join("\n\n---\n\n");
}

async function sendEmail({ to, subject, body }) {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "",
    body,
  ].join("\n");

  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  return `Email sent to ${to} with subject "${subject}"`;
}

module.exports = { listEmails, sendEmail };
