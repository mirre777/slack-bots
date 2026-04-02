# Slack Bots

Claude-powered Slack bots deployed on Vercel with tool integrations.

## Architecture

```
Slack ←→ Vercel Serverless Functions ←→ Claude API (tool_use)
                                     ←→ Gmail API
                                     ←→ Google Calendar API
                                     ←→ Twilio WhatsApp API
                                     ←→ Upstash Redis (message storage)
```

## Bots

### Bot 1 — Personal Assistant
- **Endpoint:** `/api/bot1`
- **Features:**
  - Gmail: read and send emails
  - Google Calendar: view and create events
  - WhatsApp: send messages via Twilio
  - Uses Claude tool_use for intelligent routing

### Bot 2 — General Assistant
- **Endpoint:** `/api/bot2`
- **Features:**
  - General Q&A powered by Claude
  - No tool integrations (yet)

## Webhooks

### WhatsApp Incoming
- **Endpoint:** `/api/whatsapp`
- **Flow:** Incoming WhatsApp message → stored in Redis → forwarded to Slack
- **Twilio sandbox** receives messages and forwards to this endpoint

## Scheduled Jobs

### Daily Summary
- **Endpoint:** `/api/summary`
- **Schedule:** Every day at 21:00 UTC (cron)
- **Flow:** Collects all WhatsApp messages from Redis → Claude generates summary → posts to Slack

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `BOT1_SIGNING_SECRET` | Slack signing secret for Bot 1 |
| `BOT1_TOKEN` | Slack bot token for Bot 1 |
| `BOT2_SIGNING_SECRET` | Slack signing secret for Bot 2 |
| `BOT2_TOKEN` | Slack bot token for Bot 2 |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth2 refresh token |
| `GOOGLE_REDIRECT_URI` | Google OAuth2 redirect URI |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp sandbox number |
| `KV_REDIS_URL` | Upstash Redis URL (via Vercel KV) |
| `SLACK_CHANNEL_ID` | Slack channel for summaries |
| `CRON_SECRET` | Secret for cron job auth |

## Project Structure

```
api/
  bot1.js          — Bot 1 handler (personal assistant with tools)
  bot2.js          — Bot 2 handler (general assistant)
  whatsapp.js      — Twilio WhatsApp incoming webhook
  summary.js       — Daily summary cron endpoint
lib/
  claude.js        — Claude API client with tool_use support
  handler.js       — Shared Slack bot handler
  slack.js         — Slack API helpers
  redis.js         — Redis storage helpers
  tools/
    gmail.js       — Gmail API integration
    calendar.js    — Google Calendar API integration
    whatsapp.js    — Twilio WhatsApp send integration
```

## Deployment

Deployed on Vercel. Push to `master` to deploy automatically.

Production URL: `https://slack-bots-self.vercel.app`
