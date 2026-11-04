// Helpers for the read-only ClickUp import (app/api/clickup/route.js), kept apart so tests can load them.

// "https://app.clickup.com/t/86a2tqk0c", "https://app.clickup.com/t/9005131470/WO-2338",
// "86a2tqk0c" or "WO-2338" -> { id, custom }
export function parseTaskRef(input) {
  const s = String(input || "").trim();
  const fromUrl = s.match(/clickup\.com\/t\/(?:\d+\/)?([A-Za-z0-9_-]+)/);
  const ref = fromUrl ? fromUrl[1] : s;
  if (/^[A-Za-z]+-\d+$/.test(ref)) return { id: ref.toUpperCase(), custom: true };
  if (/^[a-z0-9]{6,12}$/.test(ref)) return { id: ref, custom: false };
  return null;
}

// Dropdown values come back as the option's orderindex (older fields) or its id (newer ones).
export function fieldText(task, name) {
  const f = (task.custom_fields || []).find((c) => c.name === name);
  if (!f || f.value == null || f.value === "") return "";
  if (f.type === "drop_down") {
    const opts = f.type_config?.options || [];
    const o = opts.find((x) => x.id === f.value || String(x.orderindex) === String(f.value));
    return o?.name || "";
  }
  return typeof f.value === "string" || typeof f.value === "number" ? String(f.value) : "";
}

const API = "https://api.clickup.com/api/v2";

// The fields the check needs, from one task as the v2 API returns it. Never the description.
export function taskFields(task) {
  return {
    id: task.id,
    name: task.name || "",
    url: task.url || "",
    status: task.status?.status || "",
    quote: fieldText(task, "Client Quote") || fieldText(task, "Tech Quote"),
    state: fieldText(task, "State").toUpperCase().slice(0, 2),
    entity: fieldText(task, "21. Comp").toUpperCase(),
    fm: fieldText(task, "22. FM"),
  };
}

// One page (up to 100) of the workspace's tasks in the given statuses, newest update first.
// GET only: this project never writes to ClickUp.
export async function listTasks({ token, team, statuses, page = 0, timeoutMs = 15000 }) {
  const qs = new URLSearchParams({ page: String(page), subtasks: "false", include_closed: "false", order_by: "updated" });
  for (const s of statuses) qs.append("statuses[]", s);
  const r = await fetch(`${API}/team/${encodeURIComponent(team)}/task?${qs}`, {
    method: "GET",
    headers: { Authorization: token },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`ClickUp answered ${r.status}`);
  const d = await r.json();
  return { tasks: d.tasks || [], last: d.last_page ?? (d.tasks || []).length < 100 };
}

// One task by its ClickUp id. GET only.
export async function getTask({ token, id, timeoutMs = 10000 }) {
  const r = await fetch(`${API}/task/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Authorization: token },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`ClickUp answered ${r.status}`);
  return r.json();
}
