// Eval harness for the crew-check chatbot.
//
// Usage:
//   node evals/run_eval.js                                       25 cases, default BASE
//   node evals/run_eval.js https://crew-check-five.vercel.app
//   node evals/run_eval.js https://crew-check-five.vercel.app --holdout
//   node evals/run_eval.js http://localhost:3000 --agentic       the agentic retrieval experiment
//
// --agentic asks the server for mode "agentic" (lib/agentic.js). The server must have
// AGENTIC_RETRIEVAL=on; a case the server answers with the fixed pipeline is marked ERROR, so a
// fixed-pipeline score can never be reported as an agentic one.
//
// Environment:
//   CREW_CHECK_PASSCODE   the site passcode, if the middleware gate is on
//   NODE_USE_ENV_PROXY=1  node's built in fetch ignores HTTPS_PROXY without this
//
// No dependencies. Node 20 or newer builtins only.
// Each case spends real API credit on the owner's key. The run is sequential.
//
// The scoring rules live in evals/scoring.js, shared with the browser runner at /eval
// (app/eval/page.js), so both measure with the same ruler. This file is the Node side: it reads
// the files, calls the deployment, prints, and writes the result file.
//
// See CLAUDE.md for the definition of "indexed corpus", the deny list, and the
// pass/flag mapping. The mapping is an interpretation, not a specification.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DENY, createScorer, criteriaFor, parseCases, stateOf, summarize, toResult } from "./scoring.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const HOLDOUT = argv.includes("--holdout");
const firstPositional = argv.find((a) => !a.startsWith("--"));
const BASE = (firstPositional || "https://crew-check-five.vercel.app").replace(/\/+$/, "");
const SET = HOLDOUT ? "holdout" : "cases";
const CASES_FILE = path.join(HERE, `${SET}.jsonl`);
const MODE = argv.includes("--agentic") ? "agentic" : "fixed";
const SUFFIX = MODE === "agentic" ? "-agentic" : "";

const PASSCODE = process.env.CREW_CHECK_PASSCODE || "";
const authHeader = PASSCODE ? { authorization: "Basic " + Buffer.from(`check:${PASSCODE}`).toString("base64") } : {};

// ------------------------------------------------------------------- banner
const BANNER = [
  "===============================================================================",
  "  NO EMBEDDING VECTOR WAS SENT.",
  "",
  "  The 384 dim all-MiniLM-L6-v2 embedding is computed in the browser. This",
  "  runner is a node client, so it cannot supply one. /api/check therefore fell",
  "  back to KEYWORD-ONLY retrieval: no semantic card search, no similar past",
  "  jobs block. Real browser users get a different retrieval path.",
  "",
  "  This score does not describe what browser users get.",
  "===============================================================================",
].join("\n");

// ------------------------------------------------------- corpus and plan states
// Read here, parsed in scoring.js the same way the browser runner parses them.
let scorer;
try {
  scorer = createScorer({
    cardsSrc: fs.readFileSync(path.join(ROOT, "data", "cards.js"), "utf8"),
    skillSrc: fs.readFileSync(path.join(ROOT, "data", "SKILL-v6.7.md"), "utf8"),
  });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

// ---------------------------------------------------------------------- load
if (!fs.existsSync(CASES_FILE)) {
  console.error(`No case file at ${CASES_FILE}`);
  process.exit(2);
}
let cases;
try {
  cases = parseCases(fs.readFileSync(CASES_FILE, "utf8"), `${SET}.jsonl`);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

console.log(BANNER);
console.log(`\nBASE: ${BASE}`);
console.log(`Set: ${SET}.jsonl (${cases.length} cases)`);
console.log(`Mode: ${MODE}`);
console.log(`Passcode: ${PASSCODE ? "sent" : "not set"}`);
console.log(`Corpus: ${scorer.corpusSize} citation strings parsed from data/cards.js and data/SKILL-v6.7.md`);
console.log(`Deny list: ${DENY.join(", ")}\n`);

// ----------------------------------------------------------------- run cases
const rows = [];
let model = "";

for (const c of cases) {
  const state = stateOf(c.quote_text);
  const row = { id: c.id, state, expected: c.expected_verdict, expected_issue_type: c.expected_issue_type };
  let d;
  // Wall clock as this client sees it: network to the deployment plus the whole check.
  const started = Date.now();
  try {
    const r = await fetch(`${BASE}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: JSON.stringify({ quote: c.quote_text, state, ...(MODE === "agentic" ? { mode: "agentic" } : {}) }),
    });
    row.http = r.status;
    // A 401 or an error page is not JSON. Mark the case, never abort the run.
    try {
      d = await r.json();
      row.latency_ms = Date.now() - started;
    } catch (e) {
      const hint = r.status === 401 ? "401, the site is locked: set CREW_CHECK_PASSCODE" : `not JSON (${String(e).slice(0, 80)})`;
      rows.push({ ...row, result: "ERROR", why: [hint] });
      console.log(`${c.id.padEnd(16)} ERROR  http ${r.status}  ${hint}`);
      continue;
    }
  } catch (e) {
    rows.push({ ...row, result: "ERROR", why: [`network: ${String(e.cause || e).slice(0, 120)}`] });
    console.log(`${c.id.padEnd(16)} ERROR  network ${String(e.cause || e).slice(0, 80)}`);
    continue;
  }

  const scored = scorer.scoreReply(c, d, row, MODE);
  rows.push(scored);
  if (scored.result === "ERROR") {
    console.log(`${c.id.padEnd(16)} ERROR  ${scored.why[0]}`);
    continue;
  }
  model = d.model || model;

  const { result, why, predicted, head, osha, safety, two_person: twoP, tech2_hours: t2 } = scored;
  console.log(
    `${c.id.padEnd(16)} ${result}  ` +
    `exp=${String(c.expected_verdict).padEnd(4)} got=${predicted.padEnd(4)} | ` +
    `head=${head.padEnd(8)} OSHA=${osha.padEnd(7)} Safety=${safety.padEnd(7)} 2p=${twoP.padEnd(7)} T2h=${t2 ?? "-"} ${row.latency_ms}ms` +
    (why.length ? `\n${" ".repeat(18)}${why.join("; ")}` : "")
  );
}

// ------------------------------------------------------------------- summary
const s = summarize(rows);
const { scored, errors, passed, score, fps, fns, cleanScored, cleanFp, cleanFpRate, allOut, allDeeper, allDeny } = s;

const line = (t) => console.log(t);
line("\n" + "=".repeat(79));
line(`SCORE: ${passed}/${rows.length} = ${score.toFixed(1)}%   (errors count as failures: ${errors.length} error${errors.length === 1 ? "" : "s"})`);
line("=".repeat(79));

line(`\nFALSE POSITIVES (expected pass, predicted flag): ${fps.length}`);
for (const r of fps) line(`  ${r.id}  head=${r.head} OSHA=${r.osha} Safety=${r.safety}  -> ${r.mapping_reason.join("; ")}`);
line(`\nFalse positive rate on the clean-quote subset: ${cleanFp.length}/${cleanScored.length} = ${cleanFpRate.toFixed(1)}%  (target at most 10%)`);
for (const r of cleanFp) line(`  ${r.id}  ${r.mapping_reason.join("; ")}`);

line(`\nFALSE NEGATIVES (expected flag, predicted pass): ${fns.length}`);
for (const r of fns) line(`  ${r.id}  head=${r.head} OSHA=${r.osha} Safety=${r.safety}  issue=${r.expected_issue_type}`);

line(`\nCITATIONS NOT IN THE INDEXED CORPUS: ${allOut.length}  (target 0, this is the criterion that matters most)`);
if (!allOut.length) line("  none");
for (const x of allOut) line(`  ${x.id}: ${x.c}`);

line(`\nDENY LIST CITATIONS THAT APPEARED: ${allDeny.length}  (target 0)`);
if (!allDeny.length) line("  none");
for (const x of allDeny) line(`  ${x.id}: ${x.c}`);

line(`\nDeeper than the corpus (warning, not a failure): ${allDeeper.length}`);
for (const x of allDeeper) line(`  ${x.id}: ${x.c}`);

line(`\nExpected citation seen in the answer (informational, not scored, all expectations are UNVERIFIED):`);
for (const r of scored.filter((r) => r.expected_citation)) {
  line(`  ${r.id.padEnd(16)} ${r.expected_citation_seen ? "seen    " : "NOT seen"}  ${r.expected_citation}`);
}

line(`\nIssue type breakdown (informational, not scored):`);
for (const t of ["osha", "safety", "logic", "none"]) {
  const g = rows.filter((r) => r.expected_issue_type === t);
  const p = g.filter((r) => r.result === "PASS").length;
  if (g.length) line(`  ${t.padEnd(7)} ${p}/${g.length}`);
}

if (errors.length) {
  line(`\nERRORS: ${errors.length}`);
  for (const r of errors) line(`  ${r.id}: ${r.why.join("; ")}`);
}

line(`\nModel: ${model || "unknown"}`);
line(`Tokens: in ${s.tokens.in}, out ${s.tokens.out}, cache read ${s.tokens.cacheRead}, cache write ${s.tokens.cacheWrite}`);
line(`Cost and latency: node evals/compare.js`);
line(`Retrieval: keyword-only (no vector sent)`);
if (MODE === "agentic") {
  const fellBack = scored.filter((r) => r.agentic_fallback);
  const searches = scored.reduce((n, r) => n + r.tool_calls.length, 0);
  line(`Agentic: ${searches} searches over ${scored.length} answered cases; ${fellBack.length} fell back to the fixed pipeline`);
  for (const r of fellBack) line(`  ${r.id}: ${r.agentic_fallback}`);
}
line("\n" + BANNER);

// --------------------------------------------------------------------- write
const outPath = path.join(HERE, `result-${model || "unknown"}-${SET}${SUFFIX}.json`);
fs.writeFileSync(outPath, JSON.stringify(toResult({
  base: BASE, set: SET, mode: MODE, model, retrieval: "keyword-only", vectorSent: false,
  s, rows, corpusSize: scorer.corpusSize,
}), null, 2));
line(`\nWrote ${outPath}`);

// ------------------------------------------------------------ success criteria
const criteria = criteriaFor(s);

// The holdout criterion needs both result files. Report, do not invent.
const otherSet = HOLDOUT ? "cases" : "holdout";
const otherPath = path.join(HERE, `result-${model || "unknown"}-${otherSet}${SUFFIX}.json`);
if (model && fs.existsSync(otherPath)) {
  try {
    const other = JSON.parse(fs.readFileSync(otherPath, "utf8"));
    const gap = Math.abs(score - other.score);
    criteria.push({ name: "holdout within 10 points of the main score", ok: gap <= 10, got: `${gap.toFixed(1)} points` });
  } catch { /* unreadable sibling result: fall through to not evaluable */ }
} else {
  line(`\nHoldout comparison: not evaluable, ${otherSet} result file not present.`);
}

line("\nSUCCESS CRITERIA");
for (const c of criteria) line(`  ${c.ok ? "pass" : "FAIL"}  ${c.name} (${c.got})`);
const allOk = criteria.every((c) => c.ok);
line(allOk ? "\nAll criteria passed." : "\nNot done. The criteria marked FAIL above did not pass.");
process.exit(allOk ? 0 : 1);
