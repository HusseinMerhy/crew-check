// Facts read from a quote and its ClickUp task in code, never by the model: the quote's total
// against the client's NTE, overtime and whether its reason is written, and the "Quote Check"
// tick. Shown inside the tool only. The owner's rule lets the tool write one ClickUp field
// (OSHA Check), so none of these is written to ClickUp.
//
// Dollar amounts never leave this file: the NTE result is kept as a state and a percent
// ("over", 125), so nothing stored or shown carries an amount.
import { secondTechHours } from "./answer.js";

const AMOUNT = "\\$\\s?([\\d,]+(?:\\.\\d+)?)";
const num = (s) => Number(String(s).replace(/,/g, ""));
const lastOf = (re, text) => {
  let v = null;
  for (const m of text.matchAll(re)) v = num(m[1]);
  return v;
};

// Real quotes end with "Grand Total $X", or with a total per phase ("Total Incurred $X",
// "Total Additional $Y") and no grand total, or with a plain "Total $X" (Nov 13: 23,762 of
// 23,869 past quotes have one of these). The last line of each kind wins: a "before tax" line
// comes before the line with tax ("Total Incurred before tax", "Tax 7%", "Total Incurred"), and
// when it is the only one it is still the closest figure there is.
const GRAND = new RegExp(`^[ \\t]*grand[ \\t]+total\\b[^$\\n]{0,30}${AMOUNT}`, "gim");
const INCURRED = new RegExp(`^[ \\t]*total[ \\t]+incurred\\b[^$\\n]{0,30}${AMOUNT}`, "gim");
const ADDITIONAL = new RegExp(`^[ \\t]*(?:total[ \\t]+additional|additional[ \\t]+total)\\b[^$\\n]{0,30}${AMOUNT}`, "gim");
const PLAIN = new RegExp(`^[ \\t]*total[ \\t]*:?[ \\t]*${AMOUNT}`, "gim");

export function quoteTotal(raw) {
  const text = String(raw || "").replace(/ /g, " ");
  const grand = lastOf(GRAND, text);
  if (grand != null) return grand;
  const inc = lastOf(INCURRED, text), add = lastOf(ADDITIONAL, text);
  if (inc != null || add != null) return Math.round(((inc || 0) + (add || 0)) * 100) / 100;
  return lastOf(PLAIN, text);
}

// The client's NTE against the quote's total. The NTE covers the whole job, so a quote in phases
// is compared on its grand total, as OBI compares its dearest option.
//   over      the quote is above the NTE: ask the client for an increase before sending
//   within    at or under the NTE
//   no nte    the task has no NTE
//   no total  no total line was found in the quote
export function nteFact(raw, nte) {
  const cap = Number(nte);
  if (!(cap > 0)) return { state: "no nte", pct: null };
  const total = quoteTotal(raw);
  if (total == null) return { state: "no total", pct: null };
  const pct = Math.round((100 * total) / cap);
  return { state: total > cap + 0.004 ? "over" : "within", pct };
}

// Plain words for the tool, with no amounts.
export function nteText(f) {
  if (!f || !f.state) return null;
  if (f.state === "over") return `Over NTE: the quote is ${f.pct}% of the NTE. Ask the client for an NTE increase before sending.`;
  if (f.state === "within") return `Within NTE (${f.pct}% of it).`;
  if (f.state === "no nte") return "No NTE on the work order.";
  return "No total line found in the quote, so the NTE was not compared.";
}

// Overtime on a labor line, and whether the quote says why. The same words as the Nov 13
// baseline study of 23,873 past quotes (21% with overtime, 6% with a reason written), so the
// tool's numbers and the study's can be read side by side. "After hours" counts as both: it says
// when the work happens, which is what the overtime rate is for.
const OT = /\b(?:OT|overtime|after[- ]?hours?|double[- ]time)\b/i;
const HOURS = /\d+(?:\.\d+)?\s*(?:labou?r\s*)?(?:hours?|hrs?|h)\b/i;
const LABOR = /labou?r|tech(?:nician)?|helper|apprentice/i;
const OT_WHY = /after[- ]?hours|outside (?:of )?(?:normal |regular )?(?:business|store|operating) hours|before (?:the )?store opens|after (?:the )?store closes|store (?:is )?closed|emergency|urgent|weekend|holiday|overnight|night|requested by|client request|per (?:the )?(?:client|fm|store)/i;

export function overtimeOf(quote) {
  const text = String(quote || "");
  const billed = text.split("\n").some((l) => HOURS.test(l) && LABOR.test(l) && OT.test(l));
  if (!billed) return { billed: false, reason: false };
  const why = text.match(OT_WHY);
  return { billed: true, reason: !!why, words: why ? why[0] : null };
}

export function overtimeText(o) {
  if (!o?.billed) return null;
  return o.reason
    ? `Overtime billed, reason written ("${o.words}").`
    : "Overtime billed with no reason written. Say why (store hours, emergency, client request) or quote regular time. Rule not agreed yet: for review.";
}

// The "Quote Check" checkbox on the task: true ticked, false not ticked, null not on the list.
export const QC_FIELD = "Quote Check";
export function quoteCheckOf(task, name = process.env.CLICKUP_QC_FIELD || QC_FIELD) {
  const f = (task?.custom_fields || []).find((c) => c.name === name);
  if (!f) return null;
  return f.value === true || f.value === "true" || f.value === 1 || f.value === "1";
}

// The NTE as ClickUp sends it: a currency field ("16. Client NTE 🔴" on the Vista lists, plain
// "NTE" or "Client NTE" elsewhere), its value a string of dollars.
export function nteOf(task) {
  const fields = task?.custom_fields || [];
  const f = fields.find((c) => /^16\.\s*client nte/i.test(c.name || "")) || fields.find((c) => /^(client )?nte\b/i.test((c.name || "").trim()));
  const v = Number(f?.value);
  return v > 0 ? v : null;
}

// Everything the tool keeps about a task between checks, from the raw ClickUp task and its
// fields (taskFields). No amounts: the NTE result is a state and a percent.
export function liveFacts(task, t, hashOf) {
  const nte = nteFact(t.quote, nteOf(task));
  return {
    id: t.id,
    status: t.status || null,
    quote_check: quoteCheckOf(task),
    nte_state: nte.state,
    nte_pct: nte.pct,
    now_hash: t.quote.trim() ? hashOf(t) : null,
    now_t2_hours: t.quote.trim() ? secondTechHours(t.quote) || 0 : null,
  };
}
