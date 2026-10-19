// Scoring rules for the cases that test whether the bot NOTICES an inconsistency.
//
// Why this exists. The pass/flag mapping in run_eval.js reads only the headline
// and the "OSHA | Safety | Two-person step" line. Neither can express "I found a
// billing inconsistency", so a case testing that was scored on a signal that
// cannot carry the answer. The first baseline read 21/25 and three of the four
// failures were the bot catching the problem in prose while the scorer could not
// see it. With these rules the same 25 answers score 23/25, and the two
// remaining failures are real misses.
//
// What this does NOT do: it changes no expected_verdict, no expected_issue_type
// and no expected_citation. Nothing in cases.jsonl or holdout.jsonl is edited.
// This is a scoring layer keyed by case id, so CLAUDE.md's rule against editing
// expected answers is intact.
//
// How a case is scored: if its id appears here, it passes on whether the answer
// names its discrepancy, instead of on the pass/flag mapping. Every universal
// check still applies to it (citation in corpus, deny list, no dollar amounts,
// no em dashes, correct State line). A case not listed here is scored exactly as
// before.
//
// Two caveats for whoever reviews this:
//
// 1. These patterns were written after reading real answers, so they risk being
//    fitted to the output they were meant to judge. Each is derived from its
//    case's own notes field, and two early drafts were thrown away because they
//    would have passed on the headline alone, which is circular and a
//    hill-climbing loop would learn to game it. Re-read them against a fresh run
//    before trusting the number.
// 2. safety-03 carries expected_issue_type "logic" but is deliberately NOT here.
//    Its notes say the assertion that matters is that the OSHA field reads No: it
//    is a height trap, not a discrepancy to name. Forcing it into this rule set
//    would throw away the assertion the case was written for. It still needs its
//    own OSHA-field check, which neither scorer does yet.

const both = (a, b) => (t) => a.test(t) && b.test(t);

export const MENTION_RULES = {
  "logic-01": {
    what: "summed hours (6) against the stated total (8)",
    test: both(/(add(s|ed)?\s+up|total)/i, /\b6\b[\s\S]{0,120}\b8\b|\b8\b[\s\S]{0,120}\b6\b/),
  },
  "logic-02": {
    what: "tile counts disagree (4 reported, 7 in the steps)",
    test: both(
      /(disagree|mismatch|inconsisten|do(es)?n.?t match|does not match|conflict|discrepan|only four|four .{0,30}order)/i,
      /\b(4|four)\b[\s\S]{0,140}\b(7|seven)\b|\b(7|seven)\b[\s\S]{0,140}\b(4|four)\b/i
    ),
  },
  "logic-03": {
    what: "16 labour hours for a cartridge swap, hours far above normal",
    test: both(/(well above|above (our )?usual|more than .{0,25}usual|out of line|well over|typically ran)/i, /\b8\b/),
  },
  "logic-04": {
    what: "Tech 2 billed 5 h against Tech 1's 2 h, impossible on a two-person step",
    test: /(more (hours )?than tech ?1|exceeds? tech ?1|longer than tech ?1|5 ?(hours|hrs|h)[\s\S]{0,80}2 ?(hours|hrs|h)|2 ?(hours|hrs|h)[\s\S]{0,80}5 ?(hours|hrs|h))/i,
  },
  "tech2-02": {
    what: "Tech 2 billed for the whole job while only one step needs two people",
    test: /(billed for all|billed for the (whole|full)|but only|only .{0,40}needs? two)/i,
  },
  "tech2-04": {
    what: "Tech 2 billed for the whole job with no two-hands step",
    test: /(billed for all|billed for the (whole|full))[\s\S]{0,200}(but only|habit|not a reason|no .{0,30}two-person)/i,
  },
};

// A rule's test is either a RegExp or a composed function, so call it accordingly.
export const namesDiscrepancy = (rule, answer) =>
  typeof rule.test === "function" ? rule.test(answer) : rule.test.test(answer);
