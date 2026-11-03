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
