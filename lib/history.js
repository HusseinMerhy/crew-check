// Vol 2: how often each of our entities (BKR, SFM, AF...) quoted a second tech for a job type.
// Shared by the check page (to show the panel) and scripts/client-profile.mjs (to build the data),
// so a quote is sorted into the same job type in both places.
//
// The numbers themselves are company data and the repository is public, so they are not in git:
// the script writes them to a local JSON file, which goes into Vercel as ENTITY_HISTORY, and
// /api/history serves it behind the site passcode.

// Our companies, as the "21. Comp" field in ClickUp names them.
export const ENTITIES = [
  { code: "BKR", label: "BKR" },
  { code: "SFM", label: "SFM" },
  { code: "AF", label: "Alpha Fixers" },
  { code: "TPM", label: "Texas Pipe Master" },
  { code: "RF", label: "RepairFected" },
  { code: "EDS", label: "EDS" },
];

// Same labels as the Tech 2 export's "Job type". First match wins, so the order matters.
export const JOB_RULES = [
  ["Water heater", /water heater|\bboiler\b/],
  ["Grease trap", /grease trap|interceptor/],
  ["Toilet / urinal", /toilet|urinal|flushometer|flush valve/],
  ["Snake / clog / drain", /snak|clog|drain|hydro ?jet|jett|backup|back up|sewer/],
  ["Sink / faucet", /faucet|\bsink\b|p-?trap/],
  ["Board-up / glass", /board.?up|plywood|glass|window/],
  ["Lock / key", /\block|rekey|re-key|\bkey\b|cylinder/],
  ["Door repair or replacement", /door|closer|hinge|threshold|panic|crash bar/],
  ["Leak / pipe", /leak|pipe|valve|water line/],
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

// The job is what the tech reported and the steps, not the parts list or the money lines.
const scopeOf = (quote) => String(quote || "").toLowerCase().split(/\n\s*(incurred|labor|parts|total)\b/)[0];
export const jobOf = (quote) => JOB_RULES.find(([, re]) => re.test(scopeOf(quote)))?.[0] ?? "Other";

// Below this many past quotes a share is too noisy to show as a number.
export const MIN_QUOTES = 20;

// history: { entities: { BKR: { jobs: { [job]: row }, all: row } }, everyone: { jobs, all }, built, source }
// row: { n, t2, t3, reason, t2h }  (t2 = share with a Tech 2; t3, reason = shares of those; t2h = median hours)
export function lookup(history, entity, quote) {
  const job = jobOf(quote);
  const mine = history?.entities?.[entity];
  const pick = (h) => (h?.jobs?.[job] && h.jobs[job].n >= MIN_QUOTES ? h.jobs[job] : null);
  return {
    job,
    hasEntity: Boolean(mine),
    entity: pick(mine),
    entityAll: mine?.all ?? null,
    everyone: pick(history?.everyone),
  };
}
