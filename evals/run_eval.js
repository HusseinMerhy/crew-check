// Eval harness for the crew-check chatbot.
//
// Usage:
//   node evals/run_eval.js                                       25 cases, default BASE
//   node evals/run_eval.js https://crew-check-five.vercel.app
//   node evals/run_eval.js https://crew-check-five.vercel.app --holdout
//
// Environment:
//   CREW_CHECK_PASSCODE   the site passcode, if the middleware gate is on
//   NODE_USE_ENV_PROXY=1  node's built in fetch ignores HTTPS_PROXY without this
//
// No dependencies. Node 20 or newer builtins only.
// Each case spends real API credit on the owner's key. The run is sequential.
//
// Helpers headType, oshaField, the dollar check and the em dash check are
// taken from tests/run.mjs, which already had them right. stateOk is adapted
// there too, with PLAN_STATES read from data/cards.js instead of hardcoded.
//
// See CLAUDE.md for the definition of "indexed corpus", the deny list, and the
// pass/flag mapping. The mapping is an interpretation, not a specification.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const HOLDOUT = argv.includes("--holdout");
const firstPositional = argv.find((a) => !a.startsWith("--"));
const BASE = (firstPositional || "https://crew-check-five.vercel.app").replace(/\/+$/, "");
const SET = HOLDOUT ? "holdout" : "cases";
const CASES_FILE = path.join(HERE, `${SET}.jsonl`);

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

// ------------------------------------------------------- corpus and denylist
// A citation is "in the indexed corpus" if it appears anywhere in data/cards.js
// (citation field or card text) or anywhere in data/SKILL-v6.7.md. Both files
// are parsed at runtime with the same extractor used on the model's answer, so
// the set cannot rot when a card or a skill version changes.
const CARDS_SRC = fs.readFileSync(path.join(ROOT, "data", "cards.js"), "utf8");
const SKILL_SRC = fs.readFileSync(path.join(ROOT, "data", "SKILL-v6.7.md"), "utf8");

// Deliberately generous: a missed citation is a missed hallucination.
const CITE_PATTERNS = [
  // OSH Act general duty clause
  /OSH\s*Act[\s,]*(?:§+|Sections?|Secs?\.?)?\s*5\s*\(\s*a\s*\)\s*\(\s*1\s*\)/gi,
  // federal CFR: 29 CFR 1910.146, 1926.502(h)(1), §1910.269(l)(2)(i)
  /(?:29\s*C\.?\s*F\.?\s*R\.?\s*)?(?:§+\s*)?\b19\d{2}\.\d+(?:\([^()\s]{1,8}\))*/g,
  // California title 8: Cal. Code Regs. tit. 8, §5157(d)(6) / §3276(e)(14)
  /(?:Cal\.?\s*Code\s*Regs\.?[^§\n]{0,40})?§+\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/g,
  /\b8\s*C\.?\s*C\.?\s*R\.?\s*§*\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/gi,
  /\btitle\s*8[\s,]*(?:sections?|secs?\.?|§+)\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/gi,
  // standards bodies named in the skill
  /\bNFPA\s*\d+[A-Z]?\b/gi,
  /\bANSI\s*Z\s*[\d.-]+/gi,
];

function normCite(raw) {
  let s = String(raw).replace(/ /g, " ").trim();
  s = s.replace(/^29\s*C\.?\s*F\.?\s*R\.?\s*/i, "");
  s = s.replace(/^Cal\.?\s*Code\s*Regs\.?\s*,?\s*/i, "");
  s = s.replace(/^tit(?:le)?\.?\s*8\s*,?\s*/i, "");
  s = s.replace(/^8\s*C\.?\s*C\.?\s*R\.?\s*/i, "");
  s = s.replace(/\b(?:sections?|secs?\.)\s*/gi, ""); // "OSH Act Section 5(a)(1)" == "OSH Act 5(a)(1)"
  s = s.replace(/§/g, "").replace(/,/g, "").replace(/\s+/g, "").replace(/[.,;:]+$/, "");
  return s.toLowerCase();
}

function extractCitations(text) {
  const out = new Map(); // key -> raw as first seen
  for (const re of CITE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of String(text || "").matchAll(re)) {
      const raw = m[0].trim();
      const key = normCite(raw);
      if (!key || /^\d{1,2}$/.test(key)) continue;
      if (!out.has(key)) out.set(key, raw);
    }
  }
  return [...out].map(([key, raw]) => ({ key, raw }));
}

const CORPUS = new Set(extractCitations(CARDS_SRC + "\n" + SKILL_SRC).map((c) => c.key));
const baseOf = (key) => { const i = key.indexOf("("); return i < 0 ? key : key.slice(0, i); };
const CORPUS_BASES = new Set([...CORPUS].map(baseOf));

// Present in the prompt, so they pass the corpus test, but must never be output.
// 1910.23(c)(7) is NOT denied: it is a real card and a real Layer 2 row.
const DENY = ["1910.269(l)(1)(i)", "1910.333", "nfpa70e"];
const isDenied = (key) => DENY.some((d) => key === d || key.startsWith(d + "(") || baseOf(key) === d);

function classifyCitation(key) {
  if (CORPUS.has(key)) return "IN";
  for (const c of CORPUS) if (c.startsWith(key + "(")) return "IN"; // broader cite of a corpus rule
  if (CORPUS_BASES.has(baseOf(key))) return "DEEPER";
  return "OUT";
}

// -------------------------------------------- plan states, read from the data
const planBlock = CARDS_SRC.match(/export\s+const\s+PLAN_STATES\s*=\s*\{([\s\S]*?)\n\}/);
const PLAN = new Set(planBlock ? [...planBlock[1].matchAll(/\b([A-Z]{2})\s*:/g)].map((m) => m[1]) : []);

// ------------------------------------------------------- answer field readers
// headType and oshaField are from tests/run.mjs.
function headType(first) {
  if (/^OSHA requires/i.test(first)) return "requires";
  if (/^OSHA may require/i.test(first)) return "may";
  if (/makes sense here for safety/i.test(first)) return "safety";
  if (/two pairs of hands/i.test(first)) return "hands";
  if (/is backed by/i.test(first)) return "backed";
  if (/doesn.t show a reason/i.test(first)) return "none";
  if (/one person on site/i.test(first)) return "alone";
  return "other";
}
function summaryLine(ans) {
  return ans.split("\n").find((l) => l.trim().startsWith("OSHA:")) || "";
}
function oshaField(ans) {
  const f = summaryLine(ans).split("|")[0];
  if (/OSHA:\s*Yes/i.test(f)) return "yes";
  if (/Need/i.test(f)) return "need";
  if (/OSHA:\s*No/i.test(f)) return "no";
  return "missing";
}
function safetyField(ans) {
  const f = summaryLine(ans).split("|")[1] || "";
  if (/Safety:\s*Yes/i.test(f)) return "yes";
  if (/Need/i.test(f)) return "need";
  if (/Safety:\s*No/i.test(f)) return "no";
  return "missing";
}
function twoPersonField(ans) {
  const f = summaryLine(ans).split("|")[2] || "";
  if (/Yes/i.test(f)) return "yes";
  if (/No/i.test(f)) return "no";
  return "missing";
}
// adapted from stateOk in tests/run.mjs
function stateLineOk(ans, st) {
  const line = ans.split("\n").find((l) => l.trim().startsWith("State:")) || "";
  if (!line) return false;
  if (!st) return /not given/i.test(line);
  if (PLAN.has(st)) return /own OSHA plan/i.test(line);
  return /follows federal/i.test(line);
}
// Tech 2 hours as billed in the quote, e.g. "Tech 2 - 3 hrs"
function tech2Hours(quote) {
  const m = String(quote).match(/tech\s*2[^0-9\n]{0,24}?(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour)/i);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------- pass / flag mapping
// This is an interpretation of the owner's principle, not his specification.
// See CLAUDE.md. Change it in both places if it is wrong.
function mapVerdict({ head, osha, safety, t2 }) {
  const why = [];
  if (head === "requires" || head === "may" || head === "safety") why.push(`headline ${head}`);
  if (osha === "yes" || osha === "need") why.push(`OSHA ${osha}`);
  if (safety === "yes") why.push("Safety yes");
  if (head === "none" && t2 != null) why.push(`no reason shown but Tech 2 billed ${t2} h`);
  return { verdict: why.length ? "flag" : "pass", why };
}

// ------------------------------------------------------------- state from id
// The two letter state is carried in the quote's "Store state:" line.
function stateOf(quote) {
  const m = String(quote).match(/store\s*state\s*:\s*([A-Za-z]{2})\b/i);
  return m ? m[1].toUpperCase() : "";
}

// ---------------------------------------------------------------------- load
if (!fs.existsSync(CASES_FILE)) {
  console.error(`No case file at ${CASES_FILE}`);
  process.exit(2);
}
const cases = fs.readFileSync(CASES_FILE, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l, i) => { try { return JSON.parse(l); } catch (e) { console.error(`Line ${i + 1} of ${SET}.jsonl is not JSON: ${e.message}`); process.exit(2); } });

console.log(BANNER);
console.log(`\nBASE: ${BASE}`);
console.log(`Set: ${SET}.jsonl (${cases.length} cases)`);
console.log(`Passcode: ${PASSCODE ? "sent" : "not set"}`);
console.log(`Corpus: ${CORPUS.size} citation strings parsed from data/cards.js and data/SKILL-v6.7.md`);
console.log(`Deny list: ${DENY.join(", ")}\n`);

// ----------------------------------------------------------------- run cases
const rows = [];
let model = "", tokensIn = 0, tokensOut = 0;

for (const c of cases) {
  const state = stateOf(c.quote_text);
  const row = { id: c.id, state, expected: c.expected_verdict, expected_issue_type: c.expected_issue_type };
  let d;
  try {
    const r = await fetch(`${BASE}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader },
      body: JSON.stringify({ quote: c.quote_text, state }),
    });
    row.http = r.status;
    // A 401 or an error page is not JSON. Mark the case, never abort the run.
    try {
      d = await r.json();
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

  if (!d || d.ok !== true) {
    const why = `api: ${d?.problem || "unknown"} ${String(d?.detail || "").slice(0, 100)}`.trim();
    rows.push({ ...row, result: "ERROR", why: [why] });
    console.log(`${c.id.padEnd(16)} ERROR  ${why}`);
    continue;
  }

  model = d.model || model;
  tokensIn += d.usage?.input_tokens || 0;
  tokensOut += d.usage?.output_tokens || 0;

  const ans = d.answer || "";
  const first = (ans.split("\n")[0] || "").trim();
  const head = headType(first);
  const osha = oshaField(ans);
  const safety = safetyField(ans);
  const twoP = twoPersonField(ans);
  const t2 = tech2Hours(c.quote_text);
  const { verdict, why: mapWhy } = mapVerdict({ head, osha, safety, t2 });

  const cites = extractCitations(ans).map((x) => ({ ...x, bucket: classifyCitation(x.key), denied: isDenied(x.key) }));
  const out = cites.filter((x) => x.bucket === "OUT");
  const deeper = cites.filter((x) => x.bucket === "DEEPER");
  const denied = cites.filter((x) => x.denied);

  const why = [];
  if (verdict !== c.expected_verdict) why.push(`verdict ${verdict}, expected ${c.expected_verdict}`);
  for (const x of out) why.push(`citation not in corpus: ${x.raw}`);
  for (const x of denied) why.push(`deny list citation: ${x.raw}`);
  if (/\$\s?\d/.test(ans)) why.push("dollar amount in answer");
  if (/\u2014/.test(ans)) why.push("em dash in answer");
  if (head !== "alone" && !stateLineOk(ans, state)) why.push("State line wrong or missing");

  const ok = why.length === 0;
  const wantCite = (c.expected_citation || "").replace(/\s*\[UNVERIFIED\]\s*$/i, "").trim();
  const citeSeen = wantCite ? cites.some((x) => x.key === normCite(wantCite)) : null;

  rows.push({
    ...row, result: ok ? "PASS" : "FAIL", why, predicted: verdict, mapping_reason: mapWhy,
    head, osha, safety, two_person: twoP, tech2_hours: t2, state_line_ok: stateLineOk(ans, state),
    expected_citation: c.expected_citation || null, expected_citation_seen: citeSeen,
    citations: cites, out_of_corpus: out.map((x) => x.raw), deeper_than_corpus: deeper.map((x) => x.raw),
    deny_hits: denied.map((x) => x.raw), search: d.search, headline: first, answer: ans,
  });

  console.log(
    `${c.id.padEnd(16)} ${ok ? "PASS" : "FAIL"}  ` +
    `exp=${String(c.expected_verdict).padEnd(4)} got=${verdict.padEnd(4)} | ` +
    `head=${head.padEnd(8)} OSHA=${osha.padEnd(7)} Safety=${safety.padEnd(7)} 2p=${twoP.padEnd(7)} T2h=${t2 ?? "-"}` +
    (why.length ? `\n${" ".repeat(18)}${why.join("; ")}` : "")
  );
}

// ------------------------------------------------------------------- summary
const scored = rows.filter((r) => r.result !== "ERROR");
const errors = rows.filter((r) => r.result === "ERROR");
const passed = scored.filter((r) => r.result === "PASS").length;
const score = rows.length ? (passed / rows.length) * 100 : 0; // errors count against the score

const fps = scored.filter((r) => r.expected === "pass" && r.predicted === "flag");
const fns = scored.filter((r) => r.expected === "flag" && r.predicted === "pass");

const cleanAll = rows.filter((r) => /(^|-)clean-/.test(r.id) || r.id.startsWith("clean-"));
const cleanScored = cleanAll.filter((r) => r.result !== "ERROR");
const cleanFp = cleanScored.filter((r) => r.predicted === "flag");
const cleanFpRate = cleanScored.length ? (cleanFp.length / cleanScored.length) * 100 : 0;

const allOut = scored.flatMap((r) => r.out_of_corpus.map((c) => ({ id: r.id, c })));
const allDeeper = scored.flatMap((r) => r.deeper_than_corpus.map((c) => ({ id: r.id, c })));
const allDeny = scored.flatMap((r) => r.deny_hits.map((c) => ({ id: r.id, c })));

const line = (s) => console.log(s);
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
line(`Tokens: in ${tokensIn}, out ${tokensOut}`);
line(`Retrieval: keyword-only (no vector sent)`);
line("\n" + BANNER);

// --------------------------------------------------------------------- write
const outPath = path.join(HERE, `result-${model || "unknown"}-${SET}.json`);
fs.writeFileSync(outPath, JSON.stringify({
  base: BASE, set: SET, model: model || null, retrieval: "keyword-only", vector_sent: false,
  ran_at: new Date().toISOString(),
  score, passed, total: rows.length, errors: errors.length,
  false_positives: fps.map((r) => r.id), false_negatives: fns.map((r) => r.id),
  clean_subset: { total: cleanScored.length, false_positives: cleanFp.map((r) => r.id), rate: cleanFpRate },
  out_of_corpus: allOut, deny_hits: allDeny, deeper_than_corpus: allDeeper,
  tokens_in: tokensIn, tokens_out: tokensOut,
  deny_list: DENY, corpus_size: CORPUS.size,
  rows,
}, null, 2));
line(`\nWrote ${outPath}`);

// ------------------------------------------------------------ success criteria
const criteria = [
  { name: "score at least 90%", ok: score >= 90, got: `${score.toFixed(1)}%` },
  { name: "zero citations not in the indexed corpus", ok: allOut.length === 0, got: String(allOut.length) },
  { name: "zero deny list citations", ok: allDeny.length === 0, got: String(allDeny.length) },
  { name: "false positive rate on clean quotes at most 10%", ok: cleanFpRate <= 10, got: `${cleanFpRate.toFixed(1)}%` },
  { name: "no errored cases", ok: errors.length === 0, got: String(errors.length) },
];

// The holdout criterion needs both result files. Report, do not invent.
const otherSet = HOLDOUT ? "cases" : "holdout";
const otherPath = path.join(HERE, `result-${model || "unknown"}-${otherSet}.json`);
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
