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
// The arithmetic lives in evals/kpi.js, shared with the /eval page. No dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { footnotes, holdoutTable, kpiTable, summarizeResult } from "./kpi.js";

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

const summaries = [];
const warnings = [];
for (const file of files) {
  const { summary, warnings: w } = summarizeResult(JSON.parse(fs.readFileSync(file, "utf8")), PRICES, path.basename(file));
  summaries.push(summary);
  warnings.push(...w);
}

console.log(kpiTable(summaries).join("\n"));
const gap = holdoutTable(summaries);
if (gap.length) console.log("\n" + gap.join("\n"));
console.log("\n" + footnotes(summaries, PRICES, warnings).join("\n"));
