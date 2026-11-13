// Vol 2: the one write this project makes to ClickUp: the "OSHA Check" text field on a work order,
// filled with the strict line from lib/fieldline.js. Approved by the owner on Nov 13, 2026 for this
// one field only. Every other ClickUp call in this project is a GET.
//
// Off unless CLICKUP_WRITE=on, and only on the lists named in CLICKUP_WRITE_LISTS (list ids,
// comma separated, or "all"). The field is found on the task by name (CLICKUP_FIELD_NAME, default
// "OSHA Check") or by id (CLICKUP_FIELD_ID). Before writing, the task is read again: if its quote
// changed while it was being checked, nothing is written, because the newer check will write.
import { crewCheckLine } from "./fieldline.js";
import { getTask, taskFields } from "./clickup.js";
import { hashOf } from "./sync.js";

const API = "https://api.clickup.com/api/v2";

export function writeSettings(env = process.env) {
  return {
    on: String(env.CLICKUP_WRITE || "").trim().toLowerCase() === "on",
    lists: String(env.CLICKUP_WRITE_LISTS || "").split(",").map((s) => s.trim()).filter(Boolean),
    fieldName: String(env.CLICKUP_FIELD_NAME || "OSHA Check").trim(),
    fieldId: String(env.CLICKUP_FIELD_ID || "").trim() || null,
  };
}

const listAllowed = (s, listId) => s.lists.includes("all") || (listId != null && s.lists.includes(String(listId)));
export const fieldOn = (task, s) => (task?.custom_fields || []).find((f) => (s.fieldId ? f.id === s.fieldId : f.name === s.fieldName)) || null;

// Whether to write, from a fresh read of the task. Pure, so every rule is tested.
export function writeDecision({ settings: s, task, checkedHash, line, hashOf }) {
  if (!s.on) return { write: false, note: "Writing to ClickUp is off (CLICKUP_WRITE)." };
  if (!line) return { write: false, note: "This answer has no field line." };
  if (!listAllowed(s, task?.list?.id)) return { write: false, note: `The list "${task?.list?.name || task?.list?.id || "?"}" is not in CLICKUP_WRITE_LISTS.` };
  const field = fieldOn(task, s);
  if (!field) return { write: false, note: `This list has no "${s.fieldId || s.fieldName}" field.` };
  if (hashOf(taskFields(task)) !== checkedHash) return { write: false, note: "The quote changed during the check; the newer check writes the field." };
  if (String(field.value ?? "") === line) return { write: false, same: true, note: "The field already says this." };
  return { write: true, fieldId: field.id };
}

// The write itself: one custom field value on one task.
async function setField({ token, taskId, fieldId, value, fetchImpl }) {
  const r = await fetchImpl(`${API}/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`, {
    method: "POST",
    headers: { Authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ value }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`ClickUp answered ${r.status} to the field write`);
}

// After a check: work out the line and write it if every rule allows. Returns
// { written, line, note }. The task is only read again when writing is on and its list is allowed,
// so with writing off this costs nothing.
export async function writeField({ token, taskId, listId, answer, quote, checkedHash, hashOf, getTask, settings = writeSettings(), fetchImpl = fetch }) {
  const line = crewCheckLine(answer, quote);
  if (!settings.on) return { written: false, line, note: "Writing to ClickUp is off (CLICKUP_WRITE)." };
  if (listId != null && !listAllowed(settings, listId)) return { written: false, line, note: "This list is not in CLICKUP_WRITE_LISTS." };
  const task = await getTask(taskId);
  const d = writeDecision({ settings, task, checkedHash, line, hashOf });
  if (!d.write) return { written: !!d.same, line, note: d.note };
  await setField({ token, taskId, fieldId: d.fieldId, value: line, fetchImpl });
  return { written: true, line, note: null };
}

// The afterCheck hook for syncQuotes, or null when writing is off (then nothing is read or written).
export function fieldWriter({ token, settings = writeSettings() }) {
  if (!settings.on || !token) return null;
  return (t, { answer }) => writeField({
    token, taskId: t.id, listId: t.listId, answer, quote: t.quote, checkedHash: t.hash, hashOf, settings,
    getTask: (id) => getTask({ token, id }),
  });
}
