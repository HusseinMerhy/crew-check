// KPI arithmetic for eval result files, shared by evals/compare.js (Node) and the /eval page (in
// the browser), so a table from either is computed the same way. Pure functions: no file reads.
// A result is the object scoring.js toResult builds, the same shape run_eval.js writes to disk.

// Nearest-rank percentile over a list of numbers.
export const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

// Cost of one check from its usage. input_tokens is only the uncached part of the prompt, so the
// two cache fields are priced separately. null when the model has no price on file.
export function costOf(usage, price) {
  if (!price || !usage) return null;
  return ((usage.input_tokens || 0) * price.input
    + (usage.cache_creation_input_tokens || 0) * price.cache_write_5m
    + (usage.cache_read_input_tokens || 0) * price.cache_read
    + (usage.output_tokens || 0) * price.output) / 1e6;
}

// n/a when there is no price or no usage; the warnings say which.
export const money = (x) => (x == null ? "n/a" : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}`);

// One result to its KPI row. `label` names it in warnings (compare.js passes the file name).
export function summarizeResult(r, prices, label) {
  const warnings = [];
  const price = prices.models[r.model];
  const answered = r.rows.filter((x) => x.result !== "ERROR");
  const costs = answered.map((x) => costOf(x.usage, price));
  const total = costs.some((c) => c == null) ? null : costs.reduce((a, b) => a + b, 0);
  const calls = answered.map((x) => x.model_calls ?? 1);
  const searches = answered.map((x) => (x.tool_calls || []).length);
  const fellBack = answered.filter((x) => x.agentic_fallback).length;
  if (fellBack) warnings.push(`${label}: ${fellBack} of ${answered.length} checks fell back to the fixed pipeline; their cost includes the failed agentic steps.`);
  const latencies = answered.map((x) => x.latency_ms).filter((x) => typeof x === "number");

  if (!answered.some((x) => x.usage)) warnings.push(`${label}: no per-case usage (written before run_eval.js recorded it), so no cost.`);
  if (!price) warnings.push(`${label}: model ${r.model} has no entry in prices.json.`);
  // Haiku 5.5 bills at a higher rate for prompts over 100,000 tokens. A check here is a few thousand.
  for (const x of answered) {
    const prompt = ((x.usage?.input_tokens || 0) + (x.usage?.cache_read_input_tokens || 0) + (x.usage?.cache_creation_input_tokens || 0)) / (x.model_calls ?? 1);
    if (/haiku/.test(r.model || "") && prompt > 100000) warnings.push(`${label}: a check averaged ${Math.round(prompt)} prompt tokens per call; the Haiku long-context rate is not applied.`);
  }

  const summary = {
    file: label, set: r.set, model: r.model, mode: r.mode || "fixed",
    retrieval: r.retrieval, score: r.score, passed: r.passed, total: r.total, errors: r.errors,
    out: r.out_of_corpus.length, deny: r.deny_hits.length, cleanFp: r.clean_subset.rate,
    perCheck: total == null || !answered.length ? null : total / answered.length,
    perPass: total == null || !r.passed ? null : total / r.passed,
    p50: pct(latencies, 50), p95: pct(latencies, 95),
    calls: calls.length ? calls.reduce((a, b) => a + b, 0) / calls.length : null,
    searches: searches.length ? searches.reduce((a, b) => a + b, 0) / searches.length : null,
    ranAt: r.ran_at,
  };
  return { summary, warnings };
}

// The KPI table as markdown lines, one row per result.
export function kpiTable(summaries) {
  const head = ["Set", "Model", "Mode", "Score", "Out-of-corpus cites", "Deny-list cites", "Clean FP rate", "Errors",
    "Cost per check", "Cost per passing case", "p50 latency", "p95 latency", "Model calls per check", "Searches per check"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const s of summaries) {
    lines.push(`| ${[
      s.set, s.model, s.mode, `${s.score.toFixed(1)}% (${s.passed}/${s.total})`, s.out, s.deny, `${s.cleanFp.toFixed(1)}%`, s.errors,
      money(s.perCheck), s.passed ? money(s.perPass) : "no passing case",
      s.p50 == null ? "n/a" : `${s.p50} ms`, s.p95 == null ? "n/a" : `${s.p95} ms`, s.calls == null ? "n/a" : s.calls.toFixed(2),
      s.searches == null ? "n/a" : s.searches.toFixed(2),
    ].join(" | ")} |`);
  }
  return lines;
}

// Holdout gap: the main set and the holdout for the same model and mode. No lines when no pair.
export function holdoutTable(summaries) {
  const pairs = [];
  for (const m of summaries.filter((s) => s.set === "cases")) {
    const h = summaries.find((s) => s.set === "holdout" && s.model === m.model && s.mode === m.mode);
    if (h) pairs.push({ m, h, gap: Math.abs(m.score - h.score) });
  }
  if (!pairs.length) return [];
  return [
    "| Model | Mode | Main score | Holdout score | Gap | Within 10 points |",
    "|---|---|---|---|---|---|",
    ...pairs.map(({ m, h, gap }) => `| ${m.model} | ${m.mode} | ${m.score.toFixed(1)}% | ${h.score.toFixed(1)}% | ${gap.toFixed(1)} points | ${gap <= 10 ? "yes" : "no"} |`),
  ];
}

// The notes printed under the tables.
export function footnotes(summaries, prices, warnings) {
  const lines = [
    `Prices: ${prices.source}, read ${prices.read_on}, ${prices.unit}. Cost per check covers answered checks; cost per passing case divides the same spend by the cases that passed, so failures count as cost.`,
    "Latency is measured by the runner: network to the deployment plus the whole check.",
  ];
  const keywordOnly = summaries.filter((s) => s.retrieval === "keyword-only");
  if (keywordOnly.length && keywordOnly.length === summaries.length) lines.push("Every run above used keyword-only retrieval (no vector sent). Quote these numbers with that caveat.");
  else if (keywordOnly.length) lines.push("Runs marked keyword-only sent no vector; the others used keyword plus meaning search, as users get. Compare like with like.");
  for (const w of [...new Set(warnings)]) lines.push(`Warning: ${w}`);
  return lines;
}
