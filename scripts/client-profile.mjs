// Vol 2, Phase 1: how often each FM accepts a second tech, by job type.
// Reads two ClickUp exports (never ClickUp itself) and prints counts only: no prices, no names.
//
//   node scripts/client-profile.mjs <all-quotes.csv> <tech2-quotes.csv>
//
// all-quotes.csv: columns "Task ID", "Task Name", "Client Quote (text)", "Status".
// tech2-quotes.csv: columns "ClickUp task ID", "WO", "Job type", "Tech 2 hours",
//   "Tech 3+ billed", "Any reason found" (the Tech 2 export the skill's history table came from).
// The exports carry no FM column, so the FM is read from the work order number format.
// Each rule below was checked against the FM field in ClickUp on a random sample; add a rule
// only after the same check. Rows no rule claims are grouped as "Other FMs"; formats shared
// by several FMs are left out entirely.
import fs from "node:fs";

const FM_RULES = [
  // 34 of 34 sampled quotes in this format were EMCOR (Oct 27, 2026).
  { fm: "EMCOR", test: (wo) => /^\d{7}-\d{8}$/.test(wo) },
];
// Mostly EMCOR, but 1 of 28 sampled was another FM: excluded rather than guessed.
const AMBIGUOUS = [(wo) => /^\d{8}$/.test(wo)];

// Same labels as the Tech 2 export's "Job type". First match wins, so the order matters.
const JOB_RULES = [
  ["Water heater", /water heater|\bboiler\b/],
  ["Grease trap", /grease trap|interceptor/],
  ["Toilet / urinal", /toilet|urinal|flushometer|flush valve/],
  ["Snake / clog / drain", /snak|clog|drain|hydro ?jet|jett|backup|back up|sewer/],
  ["Sink / faucet", /faucet|\bsink\b|p-?trap/],
  ["Leak / pipe", /leak|pipe|valve|water line/],
  ["Board-up / glass", /board.?up|plywood|glass|window/],
  ["Lock / key", /\block|rekey|re-key|\bkey\b|cylinder/],
  ["Door repair or replacement", /door|closer|hinge|threshold|panic|crash bar/],
  ["Roof", /\broof/],
  ["Ceiling tiles", /ceiling tile|ceiling/],
  ["Floor tiles", /floor|tile|carpet|grout/],
  ["HVAC / refrigeration", /hvac|\brtu\b|cooler|freezer|refrigerat|compressor|condens|thermostat|a\/c\b|air condition/],
  ["Outlets / wiring / breaker", /outlet|receptacle|breaker|wiring|wire|circuit|panel|gfci/],
  ["Lights / fixtures", /light|fixture|bulb|ballast|lamp/],
  ["Drywall / wall / paint", /drywall|sheetrock|wall|paint|patch/],
  ["Pest", /pest|rodent|roach|insect/],
  ["Cleaning", /clean/],
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

const fmOf = (wo) => {
  const w = wo.trim();
  if (AMBIGUOUS.some((t) => t(w))) return null;
  return FM_RULES.find((r) => r.test(w))?.fm ?? "Other FMs";
};

// The job is what the tech reported and the steps, not the parts list or the money lines.
const scopeOf = (quote) => quote.toLowerCase().split(/\n\s*(incurred|labor|parts|total)\b/)[0];
const jobOf = (quote) => JOB_RULES.find(([, re]) => re.test(scopeOf(quote)))?.[0] ?? "Other";

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const [allFile, tech2File] = process.argv.slice(2);
if (!allFile || !tech2File) {
  console.error("Usage: node scripts/client-profile.mjs <all-quotes.csv> <tech2-quotes.csv>");
  process.exit(1);
}
const all = readCsv(allFile);
const tech2 = new Map(readCsv(tech2File).map((r) => [r["ClickUp task ID"], r]));

// How far the keyword job type can be trusted: agreement with the Tech 2 export's own labels.
let agree = 0, compared = 0;
for (const q of all) {
  const t = tech2.get(q["Task ID"]);
  if (!t || t["Job type"] === "Other") continue;
  compared++;
  if (jobOf(q["Client Quote (text)"]) === t["Job type"]) agree++;
}

const cells = new Map(); // fm -> job -> stats
let skipped = 0;
for (const q of all) {
  const fm = fmOf(q["Task Name"]);
  if (!fm) { skipped++; continue; }
  const t = tech2.get(q["Task ID"]);
  const job = t && t["Job type"] !== "Other" ? t["Job type"] : jobOf(q["Client Quote (text)"]);
  for (const key of [job, "All jobs"]) {
    const byJob = cells.get(fm) ?? cells.set(fm, new Map()).get(fm);
    const s = byJob.get(key) ?? byJob.set(key, { n: 0, t2: 0, t3: 0, reason: 0, canceled: 0, h2: [] }).get(key);
    s.n++;
    if (q.Status === "canceled/postponed") s.canceled++;
    if (t) {
      s.t2++;
      if (t["Tech 3+ billed"] === "Yes") s.t3++;
      if (t["Any reason found"] === "Yes") s.reason++;
      s.h2.push(Number(t["Tech 2 hours"]));
    }
  }
}

console.log(`${all.length} quotes, ${tech2.size} with a Tech 2. Left out (FM format shared by several FMs): ${skipped}.`);
console.log(`Keyword job type matches the Tech 2 export's label on ${pct(agree, compared)} of ${compared} quotes.\n`);

const fms = [...cells.keys()].sort((a, b) => (a === "Other FMs") - (b === "Other FMs"));
const jobs = [...cells.get(fms[0]).entries()].sort((a, b) => b[1].n - a[1].n).map(([j]) => j);
const header = ["Job", ...fms.flatMap((f) => [`${f} quotes`, `${f} Tech 2`, `${f} Tech 3+`, `${f} reason given`, `${f} Tech 2 h`, `${f} canceled`])];
console.log(header.join("\t"));
for (const job of jobs) {
  const cols = fms.flatMap((f) => {
    const s = cells.get(f).get(job) ?? { n: 0, t2: 0, t3: 0, reason: 0, canceled: 0, h2: [] };
    return [s.n, pct(s.t2, s.n), pct(s.t3, s.t2), pct(s.reason, s.t2), median(s.h2) || "-", s.canceled];
  });
  console.log([job, ...cols].join("\t"));
}
console.log("\nCounts from invoiced and open quotes. An invoiced quote may have been revised before it was");
console.log("accepted; the export keeps only the final version, so this shows what was accepted, not what was refused.");
