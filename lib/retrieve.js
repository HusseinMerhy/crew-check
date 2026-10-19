// Search step of RAG (the keyword half: word and synonym matching).
// 1) FILTER: keep only federal cards + the store's own state cards (exact, by label).
// 2) SCORE: count keyword hits in the quote. 3) Return the top 3 with their scores.
// The meaning half (pgvector) lives in app/api/check/route.js.
import { CARDS, PLAN_STATES } from "../data/cards";

// A keyword is matched as a whole word (plus simple endings like -s, -ed, -ing), so "ft" does not match "after".
const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternFor = (kw) => "(^|[^a-z0-9])" + escapeForRegex(kw.toLowerCase()) + "(s|es|ed|d|ing)?([^a-z0-9]|$)";

// Built once when the module loads, not once per request. These regexes never change (the card
// library is a constant), and rebuilding one per keyword per card on every check was the bulk of
// the work this function did.
const PATTERNS = new Map(CARDS.map((c) => [c.id, c.keywords.map((kw) => ({ keyword: kw, re: new RegExp(patternFor(kw)) }))]));

export function findCards(quote, state, k = 3) {
  const text = " " + (quote || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const st = (state || "").toUpperCase();
  const pool = CARDS.filter((c) => c.state === "FED" || (st && c.state === st));
  const scored = pool.map((c) => {
    // hits keeps the keyword as it is written in the card, so the screen shows the original wording
    const hits = (PATTERNS.get(c.id) || []).filter((p) => p.re.test(text)).map((p) => p.keyword);
    return { card: c, score: hits.length / c.keywords.length, hits };
  }).filter((x) => x.hits.length > 0);
  scored.sort((a, b) => b.hits.length - a.hits.length || b.score - a.score);
  return scored.slice(0, k);
}

// group keeps its three existing values so nothing downstream breaks. standards is the new
// field: what the state enforces, not how much of it we have loaded. A lookup rather than
// `st in PLAN_STATES` because the object is needed either way.
export function stateStatus(state) {
  const st = (state || "").toUpperCase();
  if (!st) return { group: "not_given" };
  const plan = PLAN_STATES[st];
  if (!plan) return { group: "federal_only" };
  return {
    group: "plan",
    standards: plan.standards,
    library: plan.library,
    snapshot: plan.snapshot || null,
  };
}
