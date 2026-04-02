const TODOIST_API = "https://api.todoist.com/rest/v2";

function headers() {
  return {
    Authorization: `Bearer ${process.env.TODOIST_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function listTasks({ filter, project_id }) {
  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  if (project_id) params.set("project_id", project_id);

  const res = await fetch(`${TODOIST_API}/tasks?${params}`, {
    headers: headers(),
  });
  const tasks = await res.json();

  if (!tasks.length) return "No tasks found.";

  return tasks
    .map((t) => {
      const due = t.due ? ` (due: ${t.due.string || t.due.date})` : "";
      const priority = t.priority > 1 ? ` [P${5 - t.priority}]` : "";
      return `- ${t.content}${due}${priority}`;
    })
    .join("\n");
}

async function createTask({ content, description, due_string, priority }) {
  const body = { content };
  if (description) body.description = description;
  if (due_string) body.due_string = due_string;
  if (priority) body.priority = priority;

  const res = await fetch(`${TODOIST_API}/tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const task = await res.json();
  return `Task created: "${task.content}"${task.due ? ` (due: ${task.due.string || task.due.date})` : ""}`;
}

async function completeTask({ task_id }) {
  await fetch(`${TODOIST_API}/tasks/${task_id}/close`, {
    method: "POST",
    headers: headers(),
  });
  return `Task ${task_id} marked as complete.`;
}

module.exports = { listTasks, createTask, completeTask };
