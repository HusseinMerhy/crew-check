// What each OSHA Check line means for the TL, and the words to tell the dispatcher. One place, used
// by the /guide page and by each work order's panel on /queue, so the two can never say different
// things. The field itself stays the strict line agreed with dispatch (lib/fieldline.js); these
// words live in the tool only.
//
// "decision" is the TL's short answer: Rejected (send the quote back), On hold (one fact first),
// Approved (keep Tech 2), Nothing to do.
import { LINES } from "./fieldline.js";

export const GUIDE = [
  {
    key: LINES.red.key, line: `${LINES.red.key}: ${LINES.red.text}`, decision: "Rejected", tone: "tape",
    means: "The quote bills a second tech but does not say why two people are needed at the same time.",
    tell: "Tech 2 is not justified as written. Either take Tech 2 off, or add the step that needs two people and why, for example \"one tech holds the 120 lb mirror level while the other sets the clips\". Then move the work order back to quote ready so it is checked again.",
  },
  {
    key: LINES.ask.key, line: `${LINES.ask.key}: <the one fact to confirm>`, decision: "On hold", tone: "warn",
    means: "One fact decides whether Tech 2 is needed, and the quote does not give it. The field names the fact.",
    tell: "Find out the fact named in the field (for example the mirror's weight, or whether there is hot work) and write it in the quote. Then move the work order back to quote ready so it is checked again.",
  },
  {
    key: LINES.osha.key, line: `${LINES.osha.key}: ${LINES.osha.text}`, decision: "Approved", tone: "sig",
    means: "An OSHA rule requires a second person for this work.",
    tell: "Keep Tech 2: an OSHA rule requires a second person here. Do not remove it to lower the price.",
  },
  {
    key: LINES.safety.key, line: `${LINES.safety.key}: ${LINES.safety.text}`, decision: "Approved", tone: "ok",
    means: "No OSHA rule applies, but the quote gives a safety reason for two people (a heavy lift, a height, an awkward hold).",
    tell: "Keep Tech 2: the safety reason is written. Make sure the Tech 2 hours match the steps that need two people, not the whole job.",
  },
  {
    key: LINES.two.key, line: `${LINES.two.key}: ${LINES.two.text}`, decision: "Approved", tone: "ok",
    means: "A step in the quote needs two people at the same time, and the quote says so.",
    tell: "Keep Tech 2: a step needs two people. Make sure the Tech 2 hours match that step, not the whole job.",
  },
  {
    key: LINES.one.key, line: `${LINES.one.key}: ${LINES.one.text}`, decision: "Nothing to do", tone: "wait",
    means: "The quote bills one tech only.",
    tell: "Nothing to change for Tech 2.",
  },
];

// Shown in the tool only, never written to ClickUp.
export const NOTES = [
  {
    key: "Over NTE", decision: "On hold", tone: "warn",
    means: "The quote's total is above the client's NTE. The tool shows it as a percent of the NTE, never an amount.",
    tell: "Do not send it as it is. Ask the client for an NTE increase first, or bring the quote under the NTE.",
  },
  {
    key: "Overtime, no reason", decision: "For review", tone: "wait",
    means: "Overtime is billed and the quote does not say why. The rule for when overtime is OK is not agreed yet.",
    tell: "Write why overtime is needed (store hours, emergency, client request), or quote regular time.",
  },
];

// The guide entry for a field line, phase or not: "NO REASON (Additional): ..." -> NO REASON.
export function guideFor(line) {
  const key = String(line || "").split(":")[0].replace(/\s*\(.*\)$/, "").trim();
  return GUIDE.find((g) => g.key === key) || null;
}
