// How an answer is read on screen, shared by the check page and the daily queue.
// The bot answers in plain text, and the line a dispatcher actually scans is the summary:
//   OSHA: ... | Safety: ... | Two-person step: ...
// Pull that line, the State, Permit and "Worth checking" lines out of the paragraph so each can be
// shown on its own. Nothing here is required to succeed: when the shape is not found, ok is false
// and the caller prints the answer unchanged, so a wording change in the skill can soften the
// layout but can never blank the screen.
// The six headlines the skill allows. A quote split into phases (Incurred, Additional Repair)
// gets an answer that opens with the phase name, so the headline is found, not assumed to be line 1.
const HEADLINE = /^(OSHA requires|OSHA may require|A second tech makes sense|The second tech is|This quote doesn.t show a reason|One person on site)/i;
const PHASE = /^\s*(incurred|additional repair|additional|phase\s*\d*|repair)[^:]{0,20}:?\s*/i;

export function parseAnswer(text) {
  const lines = String(text || "").split("\n");
  let headIdx = lines.findIndex((l) => HEADLINE.test(l.trim().replace(PHASE, "")));
  if (headIdx < 0) headIdx = 0;
  const find = (re) => lines.findIndex((l) => re.test(l.trim()));
  const oshaIdx = find(/^OSHA:/);
  const stateIdx = find(/^State:/);
  const permitIdx = find(/^permit:/i);
  const worthIdx = find(/^worth checking:/i);

  const verdicts = [];
  if (oshaIdx >= 0) {
    for (const part of lines[oshaIdx].split("|")) {
      const seg = part.trim();
      const at = seg.indexOf(":");
      if (at < 0) continue;
      verdicts.push({ label: seg.slice(0, at).trim(), value: seg.slice(at + 1).trim() });
    }
  }
  // The summary line is only lifted out of the body once it has produced the three fields the
  // tiles need. Fewer than that and it stays in the body as written: a line is never dropped
  // from the screen just because it did not parse.
  const tiled = verdicts.length >= 3;
  const lifted = new Set([headIdx, tiled ? oshaIdx : -1, stateIdx, permitIdx, worthIdx].filter((i) => i >= 0));
  const after = (i, re) => (i >= 0 ? lines[i].trim().replace(re, "") : "");
  return {
    ok: oshaIdx >= 0 || stateIdx >= 0,
    headline: (lines[headIdx] || "").trim().replace(PHASE, "") || (lines[headIdx] || "").trim(),
    verdicts: tiled ? verdicts : [],
    body: lines.filter((_, i) => !lifted.has(i)).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    state: after(stateIdx, /^State:\s*/),
    permit: after(permitIdx, /^permit:\s*/i),
    worth: after(worthIdx, /^worth checking:\s*/i),
  };
}

// Hours billed for a second person, in the forms real quotes use: "Tech 2 - 4 hrs",
// "8 hours labor Tech 2", "7 hours labor helper". Null when the quote bills only Tech 1.
const T2 = "(?:tech(?:nician)?\\s*(?:#\\s*)?2|2nd\\s+tech|second\\s+tech|helper)";
const HRS = "(\\d+(?:\\.\\d+)?)\\s*(?:hours?|hrs?|h)\\b";
const HOURS_FIRST = new RegExp(`${HRS}[^\\n\\d]{0,24}?${T2}`, "i");
const TECH_FIRST = new RegExp(`${T2}[^\\n\\d]{0,24}?${HRS}`, "i");
export function secondTechHours(quote) {
  const s = String(quote || "");
  const h = Number((s.match(HOURS_FIRST) || s.match(TECH_FIRST) || [])[1]);
  return h > 0 ? h : null;
}

// One tone per headline. "No reason shown" wears the tape: it is the one that needs a person,
// but only when a second tech is billed. On a Tech 1 only quote it is simply true and fine.
export function toneOf(h, quote) {
  if (/^OSHA requires/i.test(h)) return { tone: "sig", label: "OSHA rule", icon: "shield" };
  if (/^OSHA may require/i.test(h)) return { tone: "warn", label: "Check one fact", icon: "help" };
  if (/doesn.t show a reason/i.test(h)) {
    if (quote != null && secondTechHours(quote) == null) return { tone: "wait", label: "No 2nd tech billed", icon: "check" };
    return { tone: "tape", label: "Needs a reason", icon: "alert" };
  }
  return { tone: "ok", label: "Justified", icon: "check" };
}


export function valueClass(v) {
  const s = v.toLowerCase();
  if (s.startsWith("yes")) return "yes";
  if (s.includes("need")) return "need";
  return "no";
}

// The explanation as short points, one sentence each, so it reads at a glance without being cut.
// A sentence break is a full stop, question or exclamation mark followed by a capital or a digit,
// so "29 CFR 1910.252(a)(2)(iii)" and "3.5 h" stay whole.
export function pointsOf(body) {
  return String(body || "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// The quote's first real line, for a table cell: the Tech Reported line when there is one.
export function quoteSnippet(quote, max = 90) {
  const lines = String(quote || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /tech reported/i.test(l)) || lines.find((l) => !/^wo#?\s*:/i.test(l)) || "";
  const text = line.replace(/^tech reported( that)?\s*:?\s*/i, "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
