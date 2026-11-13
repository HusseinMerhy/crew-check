// Vol 2: what the ClickUp webhook route needs, apart from the route so it can be tested.
// ClickUp calls the route when a quote reaches a waiting status (a ClickUp Automation, "Call
// webhook"). The call carries the task id and a shared secret in the URL; the tool then reads the
// task itself, GET only, and checks it with the same loop as the daily run.

// The call's body as it arrived. Normally JSON; a form body is read too, and a form field that
// itself holds JSON (a sender can put the whole task in one "payload" field) is opened.
export function readBody(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* not JSON: try a form body */ }
  const o = Object.fromEntries(new URLSearchParams(s));
  for (const [k, v] of Object.entries(o)) {
    if (/^[[{]/.test(v)) { try { o[k] = JSON.parse(v); } catch { /* left as text */ } }
  }
  return Object.keys(o).length ? o : null;
}

// The task id, wherever the caller put it: a ClickUp Automation sends the task under "payload",
// a ClickUp API webhook sends "task_id", and a hand-made test call can send "id". The first place
// that holds a well-formed id wins.
const ID = /^[A-Za-z0-9_-]{4,40}$/;
export function taskIdOf(body) {
  const b = body && typeof body === "object" ? body : {};
  let p = b.payload;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = null; } }
  p = p && typeof p === "object" ? p : {};
  const places = [b.task_id, p.id, p.task_id, p.task?.id, b.task?.id, b.data?.id, b.data?.task_id, b.id];
  return places.find((id) => typeof id === "string" && ID.test(id)) ?? null;
}

// What the call carried, as field names only (never values: a task can carry customer details),
// so the log can show why no task id was found.
export function shapeOf(body) {
  if (body == null) return "empty or unreadable body";
  if (typeof body !== "object") return `a ${typeof body}, not an object`;
  const names = (o) => Object.keys(o).slice(0, 10).join(", ");
  return Object.entries(body).slice(0, 10)
    .map(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? `${k} {${names(v)}}` : k))
    .join(", ").slice(0, 300) || "an empty object";
}

// A failure in words the person reading the queue can act on.
export function problemOf(e) {
  const m = String(e?.message || e || "error");
  const code = m.match(/ClickUp answered (\d{3})/)?.[1];
  if (["401", "403", "404"].includes(code)) {
    return `ClickUp would not show this task to the tool (answered ${code}). The token in CLICKUP_API_TOKEN cannot see it: a private or personal list is hidden from it.`;
  }
  return m.slice(0, 300);
}

// One line for the log from what syncQuotes reports for a one-task list.
export function outcomeOf(r) {
  if (r?.checked) return "Checked";
  if (r?.failed) return "Check failed";
  if (r?.unchanged) return "Already checked, same quote";
  if (r?.no_quote) return "No Client Quote on the task";
  return "Nothing to check";
}

// The log of webhook calls (the newest LOG_KEEP are kept), so /queue can show whether ClickUp's
// calls arrive and what became of each. Field names and outcomes only: no quote text, no prices.
export const LOG_KEEP = 200;
const LOG_TABLE = `create table if not exists webhook_log (
  id bigserial primary key, received_at timestamptz default now(), task_id text, task_name text,
  outcome text, detail text)`;
export async function logCall(sql, { task_id = null, outcome, detail = null }) {
  await sql.query(LOG_TABLE);
  const r = await sql.query(`insert into webhook_log (task_id, outcome, detail) values ($1, $2, $3) returning id`, [task_id, outcome, detail]);
  await sql.query(`delete from webhook_log where id <= (select max(id) from webhook_log) - $1`, [LOG_KEEP]);
  return r[0]?.id ?? null;
}
// A call with a wrong or missing secret. Anyone can make one, so at most one is logged a minute
// and nothing from the call is kept.
export const REFUSED = "Refused: wrong or missing secret";
export async function logRefused(sql) {
  await sql.query(LOG_TABLE);
  const recent = await sql.query(`select 1 from webhook_log where outcome = $1 and received_at > now() - interval '1 minute' limit 1`, [REFUSED]);
  if (recent.length) return null;
  return logCall(sql, { outcome: REFUSED, detail: "The call reached the tool, but the secret at the end of the address does not match WEBHOOK_SECRET in Vercel. Copy the full address into the automation again." });
}
export async function finishCall(sql, id, { task_name = null, outcome, detail = null }) {
  if (id == null) return;
  await sql.query(`update webhook_log set task_name = coalesce($2, task_name), outcome = $3, detail = $4 where id = $1`, [id, task_name, outcome, detail]);
}
export async function recentCalls(sql, limit = 10) {
  await sql.query(LOG_TABLE);
  return sql.query(`select id, received_at, task_id, task_name, outcome, detail from webhook_log order by id desc limit $1`, [limit]);
}

export const DEFAULT_STATUSES = ["quote ready", "!! waiting for approval"];

// The statuses the daily check reads, so the webhook and the daily run agree on what is waiting.
export function waitingStatuses(env = process.env) {
  const s = String(env.CLICKUP_SYNC_STATUSES || "").split(",").map((x) => x.trim()).filter(Boolean);
  return s.length ? s : DEFAULT_STATUSES;
}

// "!! waiting for approval" and "waiting for approval" are the same status to a person, so the
// "!!" flag and the case are ignored. Spelling is not guessed: "quote read" is not "quote ready".
const norm = (x) => String(x || "").toLowerCase().replace(/^[!\s]+/, "").replace(/\s+/g, " ").trim();
export const isWaiting = (task, statuses) => statuses.map(norm).includes(norm(task?.status?.status));

// A webhook call is checked whatever the task's status is by the time the tool reads it: a quote
// can be approved within minutes (an NTE increase sent straight to the client), and the version
// ClickUp sent must still be checked. Which tasks get sent is decided by the ClickUp automations.
// This only words the log line when the status has already moved on.
export function statusNote(task, statuses) {
  if (isWaiting(task, statuses)) return null;
  return `Status was already "${task?.status?.status || "none"}" when the tool read it; checked anyway.`;
}
