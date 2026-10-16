// Search step of RAG (v1: word and synonym matching, no embeddings yet).
// 1) FILTER: keep only federal cards + the store's own state cards (exact, by label).
// 2) SCORE: count keyword hits in the quote. 3) Return the top 3 with their scores.
import { CARDS, PLAN_STATES } from "../data/cards";

export function findCards(quote, state, k = 3) {
  const text = " " + (quote || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const st = (state || "").toUpperCase();
  const pool = CARDS.filter((c) => c.state === "FED" || (st && c.state === st));
  const scored = pool.map((c) => {
    // whole-word match (plus simple endings like -s, -ed, -ing), so "ft" does not match "after"
    const hits = c.keywords.filter((kw) => new RegExp("(^|[^a-z0-9])" + kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(s|es|ed|d|ing)?([^a-z0-9]|$)").test(text));
    return { card: c, score: hits.length / c.keywords.length, hits };
  }).filter((x) => x.hits.length > 0);
  scored.sort((a, b) => b.hits.length - a.hits.length || b.score - a.score);
  return scored.slice(0, k);
}

export function stateStatus(state) {
  const st = (state || "").toUpperCase();
  if (!st) return { group: "not_given" };
  if (st in PLAN_STATES) return { group: "plan", library: PLAN_STATES[st] };
  return { group: "federal_only" };
}
