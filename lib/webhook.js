// Vol 2: what the ClickUp webhook route needs, apart from the route so it can be tested.
// ClickUp calls the route when a quote reaches a waiting status (a ClickUp Automation, "Call
// webhook"). The call carries the task id and a shared secret in the URL; the tool then reads the
// task itself, GET only, and checks it with the same loop as the daily run.

// The task id, wherever the caller put it: a ClickUp Automation sends the task under "payload",
// a ClickUp API webhook sends "task_id", and a hand-made test call can send "id".
export function taskIdOf(body) {
  const b = body || {};
  const id = b.task_id ?? b.payload?.id ?? b.payload?.task_id ?? b.task?.id ?? b.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
}

export const DEFAULT_STATUSES = ["quote ready", "!! waiting for approval"];

// The statuses the daily check reads, so the webhook and the daily run agree on what is waiting.
export function waitingStatuses(env = process.env) {
  const s = String(env.CLICKUP_SYNC_STATUSES || "").split(",").map((x) => x.trim()).filter(Boolean);
  return s.length ? s : DEFAULT_STATUSES;
}

export const isWaiting = (task, statuses) =>
  statuses.map((s) => s.toLowerCase()).includes(String(task?.status?.status || "").toLowerCase());
