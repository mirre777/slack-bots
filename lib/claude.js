const Anthropic = require("@anthropic-ai/sdk");
const { listEmails, sendEmail } = require("./tools/gmail");
const { listEvents, createEvent } = require("./tools/calendar");
const { sendWhatsApp } = require("./tools/whatsapp");
const { listTasks, createTask, completeTask } = require("./tools/todoist");
const { getBalances, getTransactions, getExchangeRate } = require("./tools/wise");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tools = [
  {
    name: "list_emails",
    description: "List recent emails from Gmail inbox. Can filter by query.",
    input_schema: {
      type: "object",
      properties: {
        max_results: { type: "number", description: "Number of emails to fetch (default 5)" },
        query: { type: "string", description: "Gmail search query (e.g. 'from:john' or 'is:unread')" },
      },
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body text" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "list_calendar_events",
    description: "List upcoming Google Calendar events.",
    input_schema: {
      type: "object",
      properties: {
        max_results: { type: "number", description: "Number of events to fetch (default 5)" },
      },
    },
  },
  {
    name: "create_calendar_event",
    description: "Create a new Google Calendar event.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start_time: { type: "string", description: "Start time in ISO 8601 format" },
        end_time: { type: "string", description: "End time in ISO 8601 format" },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
  {
    name: "send_whatsapp",
    description: "Send a WhatsApp message via Twilio.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number with country code (e.g. +31612345678)" },
        message: { type: "string", description: "Message text to send" },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks from Todoist. Can filter with Todoist filter syntax.",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Todoist filter (e.g. 'today', 'overdue', 'p1', 'tomorrow')" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task in Todoist.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        due_string: { type: "string", description: "Due date in natural language (e.g. 'tomorrow', 'next monday', 'apr 5')" },
        priority: { type: "number", description: "Priority 1-4 (4 = urgent, 1 = normal)" },
      },
      required: ["content"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a Todoist task as complete.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to complete" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "wise_balances",
    description: "Get Wise account balances (per currency). Shows both Personal and Business accounts by default.",
    input_schema: {
      type: "object",
      properties: {
        profile_type: { type: "string", description: "Filter by account: 'personal' or 'business'. Omit for both." },
      },
    },
  },
  {
    name: "wise_transactions",
    description: "Get recent Wise transactions. Shows both Personal and Business accounts by default.",
    input_schema: {
      type: "object",
      properties: {
        profile_type: { type: "string", description: "Filter by account: 'personal' or 'business'. Omit for both." },
        currency: { type: "string", description: "Currency code (e.g. EUR, GBP, USD). Optional." },
        limit: { type: "number", description: "Number of transactions per account (default 10)" },
      },
    },
  },
  {
    name: "wise_exchange_rate",
    description: "Get current Wise exchange rate between two currencies.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source currency (e.g. EUR)" },
        to: { type: "string", description: "Target currency (e.g. USD)" },
      },
      required: ["from", "to"],
    },
  },
];

const toolHandlers = {
  list_emails: (input) => listEmails({ maxResults: input.max_results, query: input.query }),
  send_email: (input) => sendEmail({ to: input.to, subject: input.subject, body: input.body }),
  list_calendar_events: (input) => listEvents({ maxResults: input.max_results }),
  create_calendar_event: (input) => createEvent({
    summary: input.summary,
    startTime: input.start_time,
    endTime: input.end_time,
    description: input.description,
    location: input.location,
  }),
  send_whatsapp: (input) => sendWhatsApp({ to: input.to, message: input.message }),
  list_tasks: (input) => listTasks({ filter: input.filter }),
  create_task: (input) => createTask(input),
  complete_task: (input) => completeTask(input),
  wise_balances: (input) => getBalances({ profileType: input.profile_type }),
  wise_transactions: (input) => getTransactions({ profileType: input.profile_type, currency: input.currency, limit: input.limit }),
  wise_exchange_rate: (input) => getExchangeRate({ from: input.from, to: input.to }),
};

async function askClaude(systemPrompt, userMessage, useTools = false) {
  const params = {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (useTools) {
    params.tools = tools;
  }

  let response = await client.messages.create(params);

  // Handle tool use loop
  while (useTools && response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      const handler = toolHandlers[toolUse.name];
      let result;
      try {
        result = await handler(toolUse.input);
      } catch (err) {
        result = `Error: ${err.message}`;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    response = await client.messages.create({
      ...params,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
    });
  }

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "No response generated.";
}

module.exports = { askClaude };
