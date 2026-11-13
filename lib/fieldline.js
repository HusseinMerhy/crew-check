// Vol 2: the one line the "Crew check" field in ClickUp would show, so a dispatcher can act
// without opening the tool. This file only builds the line; lib/fieldwrite.js writes it to the
// "OSHA Check" field when that is switched on.
//
// Strict format: a fixed keyword in capitals, then a fixed action. Plain text, no coloured dots
// (Hector, Nov 12): a ClickUp text field shows no colour anyway. Only ASK FIRST carries words from
// the answer, because the fact to confirm differs per quote. The same verdict always reads the same.
//   NO REASON: remove Tech 2 or add a two-person step
//   ASK FIRST: whether combustibles are within 35 ft of the brazing
//   OSHA: Tech 2 required by OSHA
//   OK TWO-PERSON: Tech 2 OK, a step needs two people
//   OK SAFETY: Tech 2 OK for safety
//   ONE TECH: no Tech 2 on this quote      (not in the agreed five; proposed)
// Rules: the keyword never changes (so "contains NO REASON" filters reliably), one line of at most
// 70 characters (list view cuts longer text), no dollar amounts, no client names.
//
// A quote in phases (Incurred, Additional Repair) gets one verdict per phase. The field shows the
// phase that most needs a person, named after the keyword: "NO REASON (Additional): ...".
// Each phase is read from its own summary line ("OSHA: ... | Safety: ... | Two-person step: ..."),
// not from its headline: the skill sometimes writes a later phase's verdict inside the explanation
// without a headline, and a red phase must never hide behind a green one.
import { parseAnswer, secondTechHours, toneOf } from "./answer.js";

export const FIELD_MAX = 70;
export const LINES = {
  red: { rank: 0, key: "NO REASON", text: "remove Tech 2 or add a two-person step" },
  ask: { rank: 1, key: "ASK FIRST", text: "one fact decides Tech 2, see the tool" },
  osha: { rank: 2, key: "OSHA", text: "Tech 2 required by OSHA" },
  safety: { rank: 3, key: "OK SAFETY", text: "Tech 2 OK for safety" },
  two: { rank: 4, key: "OK TWO-PERSON", text: "Tech 2 OK, a step needs two people" },
  one: { rank: 5, key: "ONE TECH", text: "no Tech 2 on this quote" },
};
export const KEYWORDS = Object.values(LINES).map((l) => l.key);

const HEAD = /^(?:(incurred|additional repair|additional|phase\s*\d*|repair)[^:\n]{0,20}:\s*)?(OSHA requires|OSHA may require|A second tech makes sense|The second tech is|This quote doesn.t show a reason|One person on site)/i;
const SUMMARY = /OSHA:\s*([^|\n]*?)\s*\|\s*Safety:\s*([^|\n]*?)\s*\|\s*Two-person step:\s*([^\n]*)/gi;
const PHASE_AT = /\b(incurred|additional repairs?|additional|phase\s*\d+|repair)\b[^:\n.]{0,25}:/i;

const tidy = (s) => String(s || "").replace(/\$\s?[\d,]+(\.\d+)?/g, "").replace(/["“”]/g, "")
  .replace(/\s+/g, " ").trim().replace(/[\s.;,:]+$/, "");
// Short phase names, so the action after them still fits in the line.
const phaseName = (s) => s.replace(/^additional repairs?$/i, "additional").replace(/\b\w/g, (c) => c.toUpperCase());

// Shorten at a word, never mid-word, and say so with an ellipsis.
function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:(]+$/, "")}…`;
}

// The fact to confirm, as the answer words it: "Need the fall protection method" -> "fall
// protection method". A condition keeps its "whether" ("if X" becomes "whether X"), so it is
// never read as a fact.
const askOf = (s) => tidy(String(s || "").replace(/^need\s*/i, "").replace(/^the\s+/i, "").replace(/^if\s+/i, "whether "));

// One verdict per summary line, with the text of its phase.
function phasesOf(answer) {
  const text = String(answer || "");
  const hits = [...text.matchAll(SUMMARY)];
  return hits.map((m, i) => {
    const before = text.slice(i ? hits[i - 1].index + hits[i - 1][0].length : 0, m.index);
    const after = text.slice(m.index + m[0].length, hits[i + 1] ? hits[i + 1].index : text.length);
    // The phase is named at the start of its own text; skip the previous phase's "Worth checking".
    const own = before.replace(/^[\s\S]*?worth checking:[^\n]*\n/i, "");
    return {
      osha: m[1].trim(), safety: m[2].trim(), two: m[3].trim(), before: own,
      phase: tidy(own.match(PHASE_AT)?.[1] || ""),
      worth: after.match(/worth checking:\s*([^\n]+)/i)?.[1] || "",
    };
  });
}

function verdictOfPhase(p, quote) {
  if (/One person on site/i.test(p.before)) return { ...LINES.one };
  if (/^yes/i.test(p.osha)) return { ...LINES.osha };
  if (/^need/i.test(p.osha)) {
    const cond = p.before.match(/OSHA may require a second tech[^.\n]*?\bif\s+([^.\n]+)/i)?.[1];
    return { ...LINES.ask, detail: askOf(p.osha) || (cond ? askOf(`if ${cond}`) : "") || askOf(p.worth) };
  }
  if (/^yes/i.test(p.safety)) return { ...LINES.safety };
  if (/^yes/i.test(p.two)) return { ...LINES.two };
  return secondTechHours(quote) == null ? { ...LINES.one } : { ...LINES.red };
}

// Fallback for an answer with no summary line at all: one verdict per headline.
function headlineVerdicts(answer, quote) {
  const lines = String(answer || "").split("\n");
  const starts = lines.map((l, i) => (HEAD.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  return starts.map((s, k) => {
    const a = parseAnswer(lines.slice(s, starts[k + 1] ?? lines.length).join("\n"));
    const phase = tidy(lines[s].trim().match(HEAD)[1] || "");
    const tone = toneOf(a.headline, quote ?? null).tone;
    let v;
    if (/^One person on site/i.test(a.headline) || tone === "wait") v = LINES.one;
    else if (tone === "tape") v = LINES.red;
    else if (tone === "warn") v = { ...LINES.ask, detail: askOf(a.headline.match(/\bif\s+(.+)/i)?.[0]) || askOf(a.worth) };
    else if (tone === "sig") v = LINES.osha;
    else if (/makes sense here for safety/i.test(a.headline)) v = LINES.safety;
    else v = LINES.two;
    return { ...v, phase };
  });
}

export function crewCheckLine(answer, quote) {
  const phases = phasesOf(answer);
  const all = phases.length
    ? phases.map((p) => ({ ...verdictOfPhase(p, quote), phase: p.phase }))
    : headlineVerdicts(answer, quote);
  if (!all.length) return null;
  const pick = all.reduce((best, x) => (x.rank < best.rank ? x : best));
  const head = `${pick.key}${all.length > 1 && pick.phase ? ` (${phaseName(pick.phase)})` : ""}: `;
  return head + clip(pick.detail || pick.text, FIELD_MAX - head.length);
}
