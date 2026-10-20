// KPI comparison across eval result files.
//
// Usage:
//   node evals/compare.js                     every evals/result-*.json
//   node evals/compare.js a.json b.json       only these files
//
// One markdown row per result file, so two models, or the fixed pipeline and the agentic variant,
// sit side by side: the success criteria from CLAUDE.md, cost, latency and model calls per check.
// Prices come from evals/prices.json, which records the page and the date they were read.
//
// Holdout result files are summarised as totals only. They carry the holdout cases' expected
// answers, and printing their rows here would show the holdout to whoever reads the output.
//
// No dependencies. Node builtins only, like run_eval.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRICES = JSON.parse(fs.readFileSync(path.join(HERE, "prices.json"), "utf8"));

const args = process.argv.slice(2);
const files = args.length
  ? args
  : fs.readdirSync(HERE).filter((f) => /^result-.*\.json$/.test(f)).sort().map((f) => path.join(HERE, f));
if (!files.length) {
  console.error("No result files. Run node evals/run_eval.js first.");
  process.exit(2);
}

// Nearest-rank percentile over a list of numbers.
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

// Cost of one check from its usage. input_tokens is only the uncached part of the prompt, so the
// two cache fields are priced separately. null when the model has no price on file.
function costOf(usage, price) {
  if (!price || !usage) return null;
  return ((usage.input_tokens || 0) * price.input
    + (usage.cache_creation_input_tokens || 0) * price.cache_write_5m
    + (usage.cache_read_input_tokens || 0) * price.cache_read
    + (usage.output_tokens || 0) * price.output) / 1e6;
}

// n/a when there is no price or no usage; the warnings below say which.
const money = (x) => (x == null ? "n/a" : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}`);
const summaries = [];
const warnings = [];

for (const file of files) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const price = PRICES.models[r.model];
  const answered = r.rows.filter((x) => x.result !== "ERROR");
  const costs = answered.map((x) => costOf(x.usage, price));
  const total = costs.some((c) => c == null) ? null : costs.reduce((a, b) => a + b, 0);
  const calls = answered.map((x) => x.model_calls ?? 1);
  const latencies = answered.map((x) => x.latency_ms).filter((x) => typeof x === "number");

  if (!answered.some((x) => x.usage)) warnings.push(`${path.basename(file)}: no per-case usage (written before run_eval.js recorded it), so no cost.`);
  if (!price) warnings.push(`${path.basename(file)}: model ${r.model} has no entry in prices.json.`);
  // Haiku 5.5 bills at a higher rate for prompts over 100,000 tokens. A check here is a few thousand.
  for (const x of answered) {
    const prompt = ((x.usage?.input_tokens || 0) + (x.usage?.cache_read_input_tokens || 0) + (x.usage?.cache_creation_input_tokens || 0)) / (x.model_calls ?? 1);
    if (/haiku/.test(r.model || "") && prompt > 100000) warnings.push(`${path.basename(file)}: a check averaged ${Math.round(prompt)} prompt tokens per call; the Haiku long-context rate is not applied.`);
  }

  summaries.push({
    file: path.basename(file), set: r.set, model: r.model, mode: r.mode || "fixed",
    retrieval: r.retrieval, score: r.score, passed: r.passed, total: r.total, errors: r.errors,
    out: r.out_of_corpus.length, deny: r.deny_hits.length, cleanFp: r.clean_subset.rate,
    perCheck: total == null || !answered.length ? null : total / answered.length,
    perPass: total == null || !r.passed ? null : total / r.passed,
    p50: pct(latencies, 50), p95: pct(latencies, 95),
    calls: calls.length ? calls.reduce((a, b) => a + b, 0) / calls.length : null,
    ranAt: r.ran_at,
  });
}

const head = ["Set", "Model", "Mode", "Score", "Out-of-corpus cites", "Deny-list cites", "Clean FP rate", "Errors",
  "Cost per check", "Cost per passing case", "p50 latency", "p95 latency", "Model calls per check"];
console.log(`| ${head.join(" | ")} |`);
console.log(`|${head.map(() => "---").join("|")}|`);
for (const s of summaries) {
  console.log(`| ${[
    s.set, s.model, s.mode, `${s.score.toFixed(1)}% (${s.passed}/${s.total})`, s.out, s.deny, `${s.cleanFp.toFixed(1)}%`, s.errors,
    money(s.perCheck), s.passed ? money(s.perPass) : "no passing case",
    s.p50 == null ? "n/a" : `${s.p50} ms`, s.p95 == null ? "n/a" : `${s.p95} ms`, s.calls == null ? "n/a" : s.calls.toFixed(2),
  ].join(" | ")} |`);
}

// Holdout gap: the main set and the holdout for the same model and mode.
const pairs = [];
for (const m of summaries.filter((s) => s.set === "cases")) {
  const h = summaries.find((s) => s.set === "holdout" && s.model === m.model && s.mode === m.mode);
  if (h) pairs.push({ m, h, gap: Math.abs(m.score - h.score) });
}
if (pairs.length) {
  console.log("\n| Model | Mode | Main score | Holdout score | Gap | Within 10 points |");
  console.log("|---|---|---|---|---|---|");
  for (const { m, h, gap } of pairs) console.log(`| ${m.model} | ${m.mode} | ${m.score.toFixed(1)}% | ${h.score.toFixed(1)}% | ${gap.toFixed(1)} points | ${gap <= 10 ? "yes" : "no"} |`);
}

console.log(`\nPrices: ${PRICES.source}, read ${PRICES.read_on}, ${PRICES.unit}. Cost per check covers answered checks; cost per passing case divides the same spend by the cases that passed, so failures count as cost.`);
console.log("Latency is measured by the runner: network to the deployment plus the whole check.");
if (summaries.some((s) => s.retrieval === "keyword-only")) console.log("Every run above used keyword-only retrieval (no vector sent). Quote these numbers with that caveat.");
for (const w of [...new Set(warnings)]) console.log(`Warning: ${w}`);
