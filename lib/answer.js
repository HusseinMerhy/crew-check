// How an answer is read on screen, shared by the check page and the daily queue.
// The bot answers in plain text, and the line a dispatcher actually scans is the summary:
//   OSHA: ... | Safety: ... | Two-person step: ...
// Pull that line, the State, Permit and "Worth checking" lines out of the paragraph so each can be
// shown on its own. Nothing here is required to succeed: when the shape is not found, ok is false
// and the caller prints the answer unchanged, so a wording change in the skill can soften the
// layout but can never blank the screen.
export function parseAnswer(text) {
  const lines = String(text || "").split("\n");
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
  const lifted = new Set([0, tiled ? oshaIdx : -1, stateIdx, permitIdx, worthIdx].filter((i) => i >= 0));
  const after = (i, re) => (i >= 0 ? lines[i].trim().replace(re, "") : "");
  return {
    ok: oshaIdx >= 0 || stateIdx >= 0,
    headline: (lines[0] || "").trim(),
    verdicts: tiled ? verdicts : [],
    body: lines.filter((_, i) => !lifted.has(i)).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    state: after(stateIdx, /^State:\s*/),
    permit: after(permitIdx, /^permit:\s*/i),
    worth: after(worthIdx, /^worth checking:\s*/i),
  };
}

// One tone per headline. "No reason shown" wears the tape: it is the one that needs a person.
export function toneOf(h) {
  if (/^OSHA requires/i.test(h)) return { tone: "sig", label: "OSHA rule", icon: "shield" };
  if (/^OSHA may require/i.test(h)) return { tone: "warn", label: "Check one fact", icon: "help" };
  if (/doesn.t show a reason/i.test(h)) return { tone: "tape", label: "Needs a reason", icon: "alert" };
  return { tone: "ok", label: "Justified", icon: "check" };
}


export function valueClass(v) {
  const s = v.toLowerCase();
  if (s.startsWith("yes")) return "yes";
  if (s.includes("need")) return "need";
  return "no";
}
