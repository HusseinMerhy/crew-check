// Vol 2: the one line the "Crew check" field in ClickUp would show, so a dispatcher can act
// without opening the tool. PREVIEW ONLY: nothing here writes to ClickUp. The owner's rule keeps
// ClickUp read-only; writing this line needs his written OK first.
//
// Fixed format agreed with the dispatch side: a keyword that never changes, then what to do.
//   🔴 NO REASON: add a two-person step or remove Tech 2
//   🟡 ASK FIRST: whether combustibles are within 35 ft of the brazing
//   🟢 OSHA: fire watch required (welding near combustibles)
//   🟢 OK TWO-PERSON: removing the upper section
//   🟢 OK SAFETY: overhead ceiling work while the dining room stays occupied
//   ⚪ ONE TECH: no Tech 2 billed            (not in the agreed five; proposed)
// Rules: the keyword never changes (so "contains NO REASON" filters reliably), one line of about
// 70 characters (list view cuts longer text), no dollar amounts, no client names.
//
// A quote in phases (Incurred, Additional Repair) gets one verdict per phase. The field shows the
// phase that most needs a person, named after the keyword: "🔴 NO REASON (Additional): ...".
// Each phase is read from its own summary line ("OSHA: ... | Safety: ... | Two-person step: ..."),
// not from its headline: the skill sometimes writes a later phase's verdict inside the explanation
// without a headline, and a red phase must never hide behind a green one.
import { parseAnswer, secondTechHours, toneOf } from "./answer.js";

export const FIELD_MAX = 70;
export const KEYWORDS = ["🔴 NO REASON", "🟡 ASK FIRST", "🟢 OSHA", "🟢 OK TWO-PERSON", "🟢 OK SAFETY", "⚪ ONE TECH"];

const HEAD = /^(?:(incurred|additional repair|additional|phase\s*\d*|repair)[^:\n]{0,20}:\s*)?(OSHA requires|OSHA may require|A second tech makes sense|The second tech is|This quote doesn.t show a reason|One person on site)/i;

const noMoney = (s) => String(s || "").replace(/\$\s?[\d,]+(\.\d+)?/g, "");
const tidy = (s) => noMoney(s).replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[\s.;,:]+$/, "");
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
// Short phase names, so the action after them still fits in the line.
const phaseName = (s) => cap(s.replace(/^additional repairs?$/i, "additional"));

// Shorten at a word, never mid-word, and say so with an ellipsis.
function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:(]+$/, "")}…`;
}

// "Yes, overhead ceiling work" -> "overhead ceiling work". Only a value that starts with the
// expected word is used, so a "No" never ends up as the detail.
const detailOf = (v, lead) => (lead.test(String(v || "")) ? tidy(String(v).replace(lead, "")) : "");

// The two-person step, in the two ways the skill describes it. The concrete action comes first:
//   "... where one tech holds the pipe while the other fastens it"
//   "The step that needs two people is removing the upper section: the note says ..."
// A full stop inside a number ("19.69 ft") does not end the sentence.
const SENT = "(?:[^.]|\\.(?=\\d))";
const WHILE = new RegExp(`\\b((?:the )?(?:second|first|one|other) tech(?:nician)?s? ${SENT}*?\\bwhile (?:the )?(?:first|second|other)\\b[^.,;]*)`, "i");
const NEEDS = new RegExp(`steps? that needs? two (?:people|techs|persons) (?:is|are) (${SENT}+)`, "i");
function stepOf(text) {
  const w = String(text).match(WHILE);
  if (w) return tidy(w[1]).replace(/^(One|The|Other)\b/, (x) => x.toLowerCase());
  const m = String(text).match(NEEDS);
  return m ? tidy(m[1].split(/:|, as the note| as the note/)[0]) : "";
}

// The answer split into its phases; a plain answer is one block.
function blocksOf(answer) {
  const lines = String(answer || "").split("\n");
  const starts = lines.map((l, i) => (HEAD.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  return starts.map((s, k) => ({
    phase: tidy(lines[s].trim().match(HEAD)[1] || ""),
    text: lines.slice(s, starts[k + 1] ?? lines.length).join("\n"),
  }));
}

// Shorter names for the techs, so more of the step fits in the line.
const short = (s) => s.replace(/\bthe second tech(nician)?\b/gi, "Tech 2").replace(/\bthe first tech(nician)?\b/gi, "Tech 1");

// One block -> { rank, key, detail }. Lower rank needs a person sooner.
function verdictOf(text, quote) {
  const a = parseAnswer(text);
  const v = Object.fromEntries(a.verdicts.map((x) => [x.label.toLowerCase(), x.value]));
  if (/^One person on site/i.test(a.headline)) return { rank: 5, key: "⚪ ONE TECH", detail: "", fallback: "no Tech 2 billed" };
  const tone = toneOf(a.headline, quote ?? null).tone;
  if (tone === "tape") return { rank: 0, key: "🔴 NO REASON", detail: "", fallback: "add a two-person step or remove Tech 2" };
  if (tone === "wait") return { rank: 5, key: "⚪ ONE TECH", detail: "", fallback: "no Tech 2 billed" };
  if (tone === "warn") {
    // The question to ask: from "OSHA: Need whether ...", else the headline's "if ..." clause,
    // else the "Worth checking" line. Never the headline itself, which only repeats the keyword.
    const cond = a.headline.match(/\bif\s+(.+)/i)?.[1];
    return { rank: 1, key: "🟡 ASK FIRST", fallback: "one fact decides it, see the tool",
      detail: detailOf(v.osha, /^need\s*/i) || (cond ? `whether ${tidy(cond)}` : "") || tidy(a.worth) };
  }
  if (tone === "sig") {
    return { rank: 2, key: "🟢 OSHA", fallback: "an OSHA rule requires a second person",
      detail: detailOf(v.osha, /^yes,?\s*/i) || tidy(a.headline.replace(/^OSHA requires a second tech here[:,.]?\s*/i, "")) };
  }
  if (/makes sense here for safety/i.test(a.headline)) {
    return { rank: 3, key: "🟢 OK SAFETY", detail: detailOf(v.safety, /^yes,?\s*/i), fallback: "a safety reason is in the quote" };
  }
  return { rank: 4, key: "🟢 OK TWO-PERSON", detail: short(detailOf(v["two-person step"], /^yes,?\s*/i) || stepOf(a.body)), fallback: "a step needs two people" };
}

const SUMMARY = /OSHA:\s*([^|\n]*?)\s*\|\s*Safety:\s*([^|\n]*?)\s*\|\s*Two-person step:\s*([^\n]*)/gi;
const PHASE_AT = /\b(incurred|additional repairs?|additional|phase\s*\d+|repair)\b[^:\n.]{0,25}:/i;

// One verdict per summary line, with the text of its phase: what came before the line (since the
// previous one) and what follows it up to the next phase (its "Worth checking").
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
      worth: tidy(after.match(/worth checking:\s*([^\n]+)/i)?.[1] || ""),
    };
  });
}

function verdictOfPhase(p, quote) {
  const one = { rank: 5, key: "⚪ ONE TECH", detail: "", fallback: "no Tech 2 billed" };
  if (/One person on site/i.test(p.before)) return one;
  if (/^yes/i.test(p.osha)) return { rank: 2, key: "🟢 OSHA", detail: detailOf(p.osha, /^yes,?\s*/i), fallback: "an OSHA rule requires a second person" };
  if (/^need/i.test(p.osha)) {
    const cond = p.before.match(/OSHA may require a second tech[^.\n]*?\bif\s+([^.\n]+)/i)?.[1];
    return { rank: 1, key: "🟡 ASK FIRST", fallback: "one fact decides it, see the tool",
      detail: detailOf(p.osha, /^need\s*/i) || (cond ? `whether ${tidy(cond)}` : "") || p.worth };
  }
  if (/^yes/i.test(p.safety)) return { rank: 3, key: "🟢 OK SAFETY", detail: detailOf(p.safety, /^yes,?\s*/i), fallback: "a safety reason is in the quote" };
  if (/^yes/i.test(p.two)) return { rank: 4, key: "🟢 OK TWO-PERSON", detail: short(detailOf(p.two, /^yes,?\s*/i) || stepOf(p.before)), fallback: "a step needs two people" };
  if (secondTechHours(quote) == null) return one;
  return { rank: 0, key: "🔴 NO REASON", detail: "", fallback: "add a two-person step or remove Tech 2" };
}

export function crewCheckLine(answer, quote) {
  const phases = phasesOf(answer);
  // Without any summary line, fall back to the headlines.
  const all = phases.length
    ? phases.map((p) => ({ ...verdictOfPhase(p, quote), phase: p.phase }))
    : blocksOf(answer).map((b) => ({ ...verdictOf(b.text, quote), phase: b.phase }));
  if (!all.length) return null;
  const pick = all.reduce((best, x) => (x.rank < best.rank ? x : best));
  if (pick.key === "🟢 OK TWO-PERSON" && !pick.detail && all.length === 1) pick.detail = short(stepOf(answer));
  const head = `${pick.key}${all.length > 1 && pick.phase ? ` (${phaseName(pick.phase)})` : ""}: `;
  return head + clip(pick.detail || pick.fallback, FIELD_MAX - head.length);
}
