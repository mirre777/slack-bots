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

### Sentry Bridge — New issue pings
Posts Sentry issue alerts into the ops Slack channel in real time.

- **Endpoint:** `/api/sentry-alert` (POST from Sentry; accepts Internal Integration webhooks)
- **Verification:** HMAC-SHA256 of raw body against `sentry-hook-signature` header, using `SENTRY_CLIENT_SECRET`. If the secret is not set, unsigned requests are accepted and a warning is logged (test-mode only).
- **Posts to:** `OPS_SLACK_CHANNEL_ID` via Bot 1's token.
- **Setup on Sentry side:** Sentry project -> Settings -> Developer Settings -> New Internal Integration -> webhook URL = this endpoint, events = `issue`, copy the Client Secret into Vercel env `SENTRY_CLIENT_SECRET`. Pair with alert rules "New issue" and "Seen more than N times in Y min".

### Preview Deploy — `/preview <branch>`
Triggers a Vercel preview deployment for any non-production branch directly from Slack.

- **Slash command:** `/preview <branch>` in Slack (registered on Bot 1's Slack app)
- **Endpoint:** `/api/preview`
- **Invocation:** runs from any channel or DM in the workspace. Invocation channel is irrelevant.
- **Gating:** user's Slack `user_id` must be in `ALLOWED_SLACK_USER_IDS` (CSV). On first run, the handler replies with your user_id so you can add it.
- **Refuses:** the `main` branch (production safety). All other branches are fair game.
- **Broadcast channel:** `PREVIEW_SLACK_CHANNEL_ID` (currently `#deployments`). Bot 1 must be a member of the channel.
- **Flow:**
  1. Verify Slack signature with `BOT1_SIGNING_SECRET`, check allowlist
  2. Send an **ephemeral ack** to the invoking user in the channel where they typed the command
  3. POST to Vercel `/v13/deployments` with `gitSource = { type: "github", repoId, ref }`. Do **not** set `target` — Vercel rejects `target: "preview"`; preview is inferred from the branch.
  4. When the API call returns, `chat.postMessage` the deploy URL + inspector link + `<@invoker>` attribution to `PREVIEW_SLACK_CHANNEL_ID`

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
| `OPS_SLACK_CHANNEL_ID` | Slack channel ID for Sentry alerts (posted via Bot 1's token) |
| `SENTRY_CLIENT_SECRET` | Sentry Internal Integration client secret (for webhook HMAC verify) |
| `VERCEL_API_TOKEN` | Personal Vercel token used by `/preview` to create deployments |
| `VERCEL_TEAM_ID` | Vercel team ID (`team_…`) for deploy API calls |
| `ONETHING_PROJECT_ID` | `prj_…` of the OneThing project |
| `ONETHING_GITHUB_REPO_ID` | GitHub numeric repo ID for OneThing (required by Vercel deploy API) |
| `ALLOWED_SLACK_USER_IDS` | CSV of Slack user IDs allowed to trigger `/preview` |
| `PREVIEW_SLACK_CHANNEL_ID` | Channel where `/preview` broadcasts deploy results (Bot 1 must be a member) |

## Project Structure

```
api/
  bot1.js              — Bot 1 handler (personal assistant with tools)
  bot2.js              — Bot 2 handler (general assistant)
  log-sink.js          — Vercel Log Drain receiver, writes errors to Redis ring buffer
  ops.js               — /ops slash command, summarizes recent errors via Claude Haiku
  sentry-alert.js      — Sentry Internal Integration webhook, posts new issues to Slack
  preview.js           — /preview slash command, creates Vercel preview deploys (allowlisted)
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

---

## Future bots (proposed, not yet built)

Rough plans. Revisit before building to pick an option per bot.

### Support bot

Inbound customer email -> Slack `#support` thread -> Claude drafts a reply grounded in context -> human approves/edits -> bot sends via Gmail. All PII redacted before anything reaches Claude or gets logged.

**Flow sketch:**
```
support@rokxgroup.com
  -> Gmail filter labels "support"
  -> cron polls labeled unread every ~3 min (or Gmail push via Pub/Sub for real-time)
  -> /api/support-intake: redacts PII (emails, phones, IDs, names), posts thread to #support
  -> Claude drafts reply in-thread, grounded in context source
  -> human /approve or edits -> /api/support-reply sends from real address via Gmail
```

**Open decisions:**
- **Auto-send on approval, or always human-typed reply + bot just appends signature?** Autonomous is faster; human-typed is safer. Default to human-typed until we trust drafts.
- **Inbox:** reuse existing Gmail or create dedicated `support@` alias? Reuse is simpler; dedicated alias keeps triage cleaner.
- **Context source for drafts:**
  - (a) Product FAQ / docs in Redis or a file in the repo
  - (b) Last N resolved support threads as shots
  - (c) Zero context, Claude only fixes tone/grammar of a human-drafted reply
- **Sanitization boundary:** strip PII *before* building the Claude prompt, not after. Keep the real address in Redis keyed by Slack `thread_ts`, so `/approve` can look it up when sending.

**Env vars this would add:**
- `SUPPORT_SLACK_CHANNEL_ID`
- `SUPPORT_GMAIL_LABEL` (label name to filter on)
- `SUPPORT_FROM_ADDRESS` (reply-from alias)

### Coding bots (@coder + @planner)

Two Slack bots that run Claude Code autonomously against a repo and open a pull request. Same infra, different postures.

| Bot | Posture | Flow |
|-----|---------|------|
| `@coder` | Autonomous | Prompt in Slack -> spins up Claude Code -> branches, writes, tests -> `gh pr create` -> Slack ping with PR URL |
| `@planner` | Conservative | Prompt in Slack -> Claude Code writes a plan + proposed diff -> Slack draft -> human "go" -> coder flow above |

**Execution environment — pick one:**

| Option | Cold start | Tradeoffs |
|--------|-----------|-----------|
| **Vercel Sandbox** (Firecracker microVM, ephemeral) | 5-15s | Spun per task, dies after. Vercel-native. **Lean.** |
| **GitHub Actions** | 30-60s | Full CI logs, same runner as regular builds. No sandbox mgmt. Slower cold start. |
| **Fluid Compute** (long-lived Vercel Function) | Sub-second | 5-min max duration, no persistent fs -- **not suitable** for multi-step coding. |

**Guardrails (non-negotiable):**
- Write access scoped to feature branches only. Never push to `main` from a bot.
- Initial scope: read-only until `@planner` approves via Slack.
- Allowlist of repos the bot can touch (e.g. `mirre777/onething`, `mirre777/slack-bots`).
- PRs opened with `[bot]` prefix + Slack invoker's handle in description.
- Hard cap on tool-use iterations per invocation (e.g. 30) to prevent runaway.

**Open decisions:**
- Vercel Sandbox vs GH Actions (see table above)
- Autonomous-to-PR end-to-end, or plan-first handoff?
- Which repos in the allowlist at launch?
- How does the coder bot communicate progress back during long runs? Options: streams partial updates as edits to the initial Slack message; posts a thread with per-step updates; silent until PR opens.

**Env vars this would add:**
- `CODING_BOT_REPO_ALLOWLIST` (CSV of `owner/repo`)
- `CODING_BOT_MAX_ITERATIONS`
- `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (use a GitHub App, not a PAT, for scoped branch-only write)
- `VERCEL_SANDBOX_TOKEN` (if we go that route) or nothing (if GH Actions, via `gh` CLI auth in the Action)
