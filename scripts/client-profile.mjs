// Vol 2: how often each of our entities (BKR, SFM, AF...) quoted a second tech, by job type.
// Reads two ClickUp exports (never ClickUp itself) and prints counts only: no prices, no names.
//
//   node scripts/client-profile.mjs <all-quotes.csv> <tech2-quotes.csv> [--json out.json]
//
// all-quotes.csv: "Task ID", "Task Name", "Client Quote (text)", "Status", and ideally "21. Comp".
// tech2-quotes.csv: "ClickUp task ID", "Job type", "Tech 2 hours", "Tech 3+ billed",
//   "Any reason found" (the Tech 2 export the skill's history table came from).
//
// The entity comes from the export's Comp column when it has one. Without it, only the work
// order formats below can be told apart; every rule was checked against the Comp field in
// ClickUp on a random sample, and a quote no rule claims is counted for "everyone" only.
// --json writes the numbers for ENTITY_HISTORY in Vercel. That file is company data: keep it
// out of git (the repository is public).
import fs from "node:fs";
import { ENTITIES, jobOf } from "../lib/history.js";

const COMP_COLUMNS = ["21. Comp", "Comp"];
const WO_RULES = [
  // 57 of 57 sampled quotes in these two formats were BKR (Nov 3, 2026).
  { entity: "BKR", test: (wo) => /^\d{7}-\d{8}$/.test(wo) || /^\d{8}$/.test(wo) },
];

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const known = new Set(ENTITIES.map((e) => e.code));
function entityOf(q, compCol) {
  if (compCol) {
    const v = q[compCol].trim().toUpperCase();
    return known.has(v) ? v : null;
  }
  return WO_RULES.find((r) => r.test(q["Task Name"].trim()))?.entity ?? null;
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const share = (n, d) => (d ? Math.round((100 * n) / d) : null);

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [allFile, tech2File] = args;
if (!allFile || !tech2File) {
  console.error("Usage: node scripts/client-profile.mjs <all-quotes.csv> <tech2-quotes.csv> [--json out.json]");
  process.exit(1);
}
const all = readCsv(allFile);
const tech2 = new Map(readCsv(tech2File).map((r) => [r["ClickUp task ID"], r]));
const compCol = COMP_COLUMNS.find((c) => all.length && c in all[0]) ?? null;

// How far the keyword job type can be trusted: agreement with the Tech 2 export's own labels.
let agree = 0, compared = 0;
for (const q of all) {
  const t = tech2.get(q["Task ID"]);
  if (!t || t["Job type"] === "Other") continue;
  compared++;
  if (jobOf(q["Client Quote (text)"]) === t["Job type"]) agree++;
}

const raw = new Map(); // group -> job -> counts
function add(group, job, q, t) {
  const byJob = raw.get(group) ?? raw.set(group, new Map()).get(group);
  for (const key of [job, "*"]) {
    const s = byJob.get(key) ?? byJob.set(key, { n: 0, t2: 0, t3: 0, reason: 0, h2: [] }).get(key);
    s.n++;
    if (t) {
      s.t2++;
      if (t["Tech 3+ billed"] === "Yes") s.t3++;
      if (t["Any reason found"] === "Yes") s.reason++;
      s.h2.push(Number(t["Tech 2 hours"]));
    }
  }
}
let unassigned = 0;
for (const q of all) {
  const t = tech2.get(q["Task ID"]);
  const job = t && t["Job type"] !== "Other" ? t["Job type"] : jobOf(q["Client Quote (text)"]);
  add("everyone", job, q, t);
  const e = entityOf(q, compCol);
  if (e) add(e, job, q, t); else unassigned++;
}

const rowOf = (s) => ({ n: s.n, t2: share(s.t2, s.n), t3: share(s.t3, s.t2), reason: share(s.reason, s.t2), t2h: median(s.h2) });
const shape = (byJob) => ({
  all: rowOf(byJob.get("*")),
  jobs: Object.fromEntries([...byJob].filter(([k]) => k !== "*").map(([k, s]) => [k, rowOf(s)])),
});
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: `${all.length} quotes, ${tech2.size} with a Tech 2; entity from ${compCol ? `the "${compCol}" column` : "work order format (BKR only)"}`,
  everyone: shape(raw.get("everyone")),
  entities: Object.fromEntries([...raw].filter(([g]) => g !== "everyone").map(([g, m]) => [g, shape(m)])),
};

console.log(`${out.source}. Quotes with no entity: ${unassigned}.`);
console.log(`Keyword job type matches the Tech 2 export's label on ${share(agree, compared)}% of ${compared} quotes.\n`);
const groups = ["everyone", ...Object.keys(out.entities)];
console.log(["Job", ...groups.flatMap((g) => [`${g} quotes`, `${g} Tech 2`, `${g} reason given`])].join("\t"));
const jobs = Object.entries(out.everyone.jobs).sort((a, b) => b[1].n - a[1].n).map(([j]) => j);
for (const job of ["*", ...jobs]) {
  const cols = groups.flatMap((g) => {
    const h = g === "everyone" ? out.everyone : out.entities[g];
    const r = job === "*" ? h.all : h.jobs[job];
    return r ? [r.n, r.t2 == null ? "-" : `${r.t2}%`, r.reason == null ? "-" : `${r.reason}%`] : [0, "-", "-"];
  });
  console.log([job === "*" ? "All jobs" : job, ...cols].join("\t"));
}
console.log("\nAn invoiced quote may have been revised before it was accepted; the export keeps only the");
console.log("final version, so this shows what was accepted, not what was refused.");
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(out));
  console.log(`\nWrote ${jsonOut} (${fs.statSync(jsonOut).size} bytes). Paste its contents into Vercel as ENTITY_HISTORY. Do not commit it.`);
}
