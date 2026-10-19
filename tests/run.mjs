// Runs the 16 test quotes against the live checker and scores them against expected answers.
// Usage: node tests/run.mjs https://crew-check-five.vercel.app
//        node tests/run.mjs http://localhost:3000
//        CREW_CHECK_PASSCODE=... node tests/run.mjs https://crew-check-five.vercel.app
// Set CREW_CHECK_PASSCODE to the site's SITE_PASSCODE when the site is locked: the lock covers
// /api/* too, so without it every case comes back 401.
// Each run spends a little API credit (16 questions).
// tests/inputs.md is NOT in git (the quotes are real customer text), so a fresh clone cannot run this.
import fs from "node:fs";

const BASE = process.argv[2] || "https://crew-check-five.vercel.app";
const PASSCODE = process.env.CREW_CHECK_PASSCODE || "";
const AUTH = PASSCODE ? { authorization: "Basic " + Buffer.from(`check:${PASSCODE}`).toString("base64") } : {};

const inputsUrl = new URL("./inputs.md", import.meta.url);
let inputs;
try {
  inputs = fs.readFileSync(inputsUrl, "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  // Not a broken script: the file is deliberately absent. It holds real customer quotes, so it is
  // in .gitignore and never reaches GitHub. Write it by hand to run the suite.
  console.error(`Cannot run the tests: tests/inputs.md is missing.

The 16 test quotes are real customer text, so inputs.md is gitignored and is not in the
repository. A fresh clone has no copy of it. To run the suite, create the file at:

  ${inputsUrl.pathname}

with one fenced block per case, numbered to match the expected answers in this script:

  ## Case 1

  \`\`\`
  Tech Reported: ...
  Required is to ...
  \`\`\`

  ## Case 2

  \`\`\`
  ...
  \`\`\`

Continuous integration does not run this suite (it calls the live site and spends API credit);
it runs \`next build\` instead.`);
  process.exit(1);
}
const quotes = [...inputs.matchAll(/## Case (\d+)[^\n]*\n\n```\n([\s\S]*?)\n```/g)].map((m) => ({ n: +m[1], quote: m[2] }));
if (quotes.length === 0) {
  console.error(`tests/inputs.md was read but no cases were found in it.
Each case needs a "## Case N" heading, a blank line, then the quote inside a fenced \`\`\` block.`);
  process.exit(1);
}

// Expected answers, written before any model ran (see expected.md).
// head: allowed headline types. osha: allowed OSHA field values. state: expected State line group.
const E = {
  1:  { st: "TX", head: ["hands"], osha: ["no"] },
  2:  { st: "FL", head: ["may"], osha: ["need"] },
  3:  { st: "OR", head: ["safety"], osha: ["no"] },
  4:  { st: "NY", head: ["may"], osha: ["need"] },
  5:  { st: "CA", head: ["none"], osha: ["no"] },
  6:  { st: "TX", head: ["none"], osha: ["no"] },
  7:  { st: "GA", head: ["may"], osha: ["need"] },
  8:  { st: "IL", head: ["none"], osha: ["no"] },
  9:  { st: "AZ", head: ["none", "may"], osha: ["no", "need"] },
  10: { st: "OH", head: ["may", "hands"], osha: ["need", "no"] },
  11: { st: "TX", head: ["hands"], osha: ["no"] },
  12: { st: "",   head: ["none"], osha: ["no"] },
  13: { st: "WA", head: ["none"], osha: ["no"] },
  14: { st: "TX", head: ["safety"], osha: ["no"] },
  15: { st: "FL", head: ["none"], osha: ["no"] },
  16: { st: "TX", head: ["alone"], osha: ["any"] },
};
const PLAN = new Set("AK AZ CA HI IN IA KY MD MI MN NV NM NC OR SC TN UT VT VA WA WY PR".split(" "));

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
function oshaField(ans) {
  const line = ans.split("\n").find((l) => l.trim().startsWith("OSHA:")) || "";
  const f = line.split("|")[0];
  if (/OSHA:\s*Yes/i.test(f)) return "yes";
  if (/Need/i.test(f)) return "need";
  if (/OSHA:\s*No/i.test(f)) return "no";
  return "missing";
}
function stateOk(ans, st) {
  const line = ans.split("\n").find((l) => l.trim().startsWith("State:")) || "";
  if (!st) return /not given/i.test(line);
  if (PLAN.has(st)) return /own OSHA plan/i.test(line);
  return /follows federal/i.test(line);
}

let pass = 0, falseRequires = 0, tokensIn = 0, tokensOut = 0, model = "";
const rows = [];
for (const { n, quote } of quotes) {
  const e = E[n];
  // A case with no expected answer cannot be scored, and reading e.st off undefined would stop the run.
  if (!e) { rows.push({ n, result: "ERROR", why: "no expected answer for this case number" }); continue; }
  const r = await fetch(`${BASE}/api/check`, { method: "POST", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify({ quote, state: e.st }) });
  // A 401 from the lock, or a platform error page, is not JSON. Mark the one case and keep going
  // instead of letting the parse error end the whole run.
  let d;
  try {
    d = await r.json();
  } catch {
    const hint = r.status === 401 ? " Set CREW_CHECK_PASSCODE to the site's SITE_PASSCODE." : "";
    rows.push({ n, result: "ERROR", why: `HTTP ${r.status}, not JSON.${hint}` });
    continue;
  }
  if (!d.ok) { rows.push({ n, result: "ERROR", why: `${d.problem} ${d.detail || ""}` }); continue; }
  model = d.model; tokensIn += d.usage?.input_tokens || 0; tokensOut += d.usage?.output_tokens || 0;
  const ans = d.answer, first = ans.split("\n")[0].trim();
  const h = headType(first), o = oshaField(ans);
  const why = [];
  if (!e.head.includes(h)) why.push(`headline ${h}, expected ${e.head.join("/")}`);
  if (e.osha[0] !== "any" && !e.osha.includes(o)) why.push(`OSHA ${o}, expected ${e.osha.join("/")}`);
  if (h === "requires" || o === "yes") falseRequires++; // no case in this set should say OSHA requires
  if (h !== "alone" && !stateOk(ans, e.st)) why.push("State line wrong or missing");
  if (/\$\s?\d/.test(ans)) why.push("dollar amount in answer");
  if (/—/.test(ans)) why.push("em dash");
  const ok = why.length === 0; if (ok) pass++;
  rows.push({ n, result: ok ? "PASS" : "FAIL", why: why.join("; "), first });
}
console.log(`Model: ${model}`);
for (const r of rows) console.log(`${String(r.n).padStart(2)} ${r.result}${r.why ? "  " + r.why : ""}`);
console.log(`\nScore: ${pass}/${quotes.length}   False "OSHA requires": ${falseRequires} (target 0)   Tokens: in ${tokensIn}, out ${tokensOut}`);
fs.writeFileSync(new URL(`./result-${model || "unknown"}.json`, import.meta.url), JSON.stringify({ model, pass, total: quotes.length, falseRequires, tokensIn, tokensOut, rows }, null, 2));
// Non-zero exit when anything did not pass, so CI or a shell can tell without reading the log.
if (pass !== quotes.length) process.exitCode = 1;
