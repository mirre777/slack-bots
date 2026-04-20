# Slack Bots

Claude-powered Slack bots deployed on Vercel with tool integrations.

## Architecture

```
Slack ←→ Vercel Serverless Functions ←→ Claude API (tool_use)
                                     ←→ Gmail API
                                     ←→ Google Calendar API
                                     ←→ Twilio WhatsApp API
                                     ←→ Wise API (Personal + Business)
                                     ←→ Todoist API
                                     ←→ Upstash Redis (message storage)
                                     ←→ OpenWeatherMap API
```

## Bots

### Bot 1 — Personal Assistant
- **Endpoint:** `/api/bot1`
- **Features:**
  - Gmail: read and send emails
  - Google Calendar: view and create events
  - WhatsApp: send messages via Twilio
  - Todoist: view, create, and complete tasks
  - Wise: balances, transactions, exchange rates (Personal + Business)
  - Uses Claude tool_use for intelligent routing
  - Responds in Dutch by default

### Bot 2 — General Assistant
- **Endpoint:** `/api/bot2`
- **Features:**
  - General Q&A powered by Claude
  - No tool integrations (yet)

### Ops Bot — Production Error Summaries
Ops tooling for the OneThing production app. Two pieces: a passive log sink (Vercel -> Redis) and an on-demand slash command (`/ops`) that summarizes recent errors via Claude.

- **Slash command:** `/ops` in Slack (registered on Bot 1's Slack app)
- **Endpoint:** `/api/ops`
- **Usage:**
  - `/ops` — last 1h of errors (default)
  - `/ops last 24h` — last 24h
  - `/ops last 30m` — last 30 minutes
  - `/ops deployment dpl_abc` — filter by deployment ID substring
- **Flow:**
  1. Slack POSTs signed request -> signature verified with `BOT1_SIGNING_SECRET`
  2. Immediate 200 ack within Slack's 3-second window (`Checking...`)
  3. Async: reads last 500 entries from Redis `ops:errors`, filters by range
  4. Claude Haiku 4.5 summarizes (groups by deployment ID + root cause, flags patterns)
  5. POSTs result back to Slack `response_url`
- **Gating:** none (in-channel; anyone in the channel can run it)

### Log Sink — Vercel -> Redis
Receives production errors from a Vercel Log Drain. Not a Slack bot, no user interaction.

- **Endpoint:** `/api/log-sink` (POST from Vercel; GET/HEAD returns 200 + `x-vercel-verify` for drain validation)
- **HMAC:** `x-vercel-signature` verified with `LOG_SINK_SECRET`
- **Storage:** pushes compact records to Redis list `ops:errors`, capped at 500 via `LTRIM`
- **Filter:** only stores entries with `level=error|fatal` or HTTP status >= 500
- **Record shape:**
  ```json
  { "ts": 1776724500000, "level": "error", "msg": "...",
    "deploymentId": "dpl_abc", "environment": "production",
    "requestId": "iad1::...", "path": "/api/decide",
    "region": "iad1", "statusCode": 500, "source": "lambda" }
  ```
- **Source drain:** configured on the OneThing Vercel project, pointed at this endpoint, production + preview environments
- **Verification token:** `VERCEL_VERIFY_TOKEN` env var, served on every response as `x-vercel-verify` header

## Webhooks

### WhatsApp Incoming
- **Endpoint:** `/api/whatsapp`
- **Flow:** Incoming WhatsApp message → stored in Redis → forwarded to Slack
- **Twilio sandbox** receives messages and forwards to this endpoint

## Scheduled Jobs

### Morning Briefing
- **Endpoint:** `/api/morning-briefing`
- **Schedule:** Every day at 07:30 CET (05:30 UTC)
- **Flow:** Fetches calendar (today + next 3 days), Todoist tasks, unread emails, and weather (Doesburg) → Claude generates Dutch briefing → posts to Slack

### Finance Summary
- **Endpoint:** `/api/finance-summary`
- **Schedule:** Every day at 07:35 CET (05:35 UTC)
- **Flow:** Fetches Wise balances + transactions (Personal + Business) → Claude generates finance summary → posts to Slack

### Email Triage
- **Endpoint:** `/api/email-triage`
- **Schedule:** 3x per day at 08:00, 13:00, 18:00 UTC
- **Flow:** Fetches unread emails → Claude categorizes (urgent/actie/later/spam) → stars urgent emails → archives spam → extracts tasks to Todoist → posts overview to Slack

### Daily Summary
- **Endpoint:** `/api/summary`
- **Schedule:** Every day at 21:00 UTC
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
| `WISE_API_TOKEN` | Wise API token (covers Personal + Business) |
| `TODOIST_API_KEY` | Todoist API key |
| `KV_REDIS_URL` | Upstash Redis URL (via Vercel KV) |
| `SLACK_CHANNEL_ID` | Slack channel for summaries |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key (free tier) |
| `WEATHER_CITY` | City for weather data (default: Doesburg) |
| `CRON_SECRET` | Secret for cron job auth |
| `LOG_SINK_SECRET` | HMAC secret shared with the Vercel Log Drain |
| `VERCEL_VERIFY_TOKEN` | Team-scoped token echoed back on `x-vercel-verify` for drain validation |
| `OPS_SLACK_CHANNEL_ID` | Slack channel used for Sentry alerts (reserved for upcoming `sentry-alert.js`) |

## Project Structure

```
api/
  bot1.js              — Bot 1 handler (personal assistant with tools)
  bot2.js              — Bot 2 handler (general assistant)
  log-sink.js          — Vercel Log Drain receiver, writes errors to Redis ring buffer
  ops.js               — /ops slash command, summarizes recent errors via Claude Haiku
  whatsapp.js          — Twilio WhatsApp incoming webhook
  morning-briefing.js  — Morning briefing cron (calendar, tasks, emails, weather)
  finance-summary.js   — Daily finance summary cron (Wise)
  email-triage.js      — Email triage + task extraction pipeline
  summary.js           — Daily WhatsApp summary cron
lib/
  claude.js            — Claude API client with tool_use support
  handler.js           — Shared Slack bot handler (with signature verification)
  slack.js             — Slack API helpers + signature verification
  redis.js             — Redis storage helpers
  tools/
    gmail.js           — Gmail API (read, send, star, archive)
    calendar.js        — Google Calendar API (list, create events)
    whatsapp.js        — Twilio WhatsApp send integration
    wise.js            — Wise API (balances, transactions, exchange rates)
    todoist.js         — Todoist API (list, create, complete tasks)
```

## Deployment

Deployed on Vercel. Push to `master` to deploy automatically.

Production URL: `https://slack-bots-self.vercel.app`
