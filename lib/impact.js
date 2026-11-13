// Does the flag change anything? Worked out in code from the checks the tool has stored
// (auto_checks, check_versions), never by the model. Two questions:
//
// 1. Fixed after the flag. A quote whose OSHA Check line said NO REASON, and whose later version
//    either has a reason the check accepts or bills fewer Tech 2 hours. A later version is one the
//    tool checked again (check_versions), or the quote as ClickUp has it now (now_hash and
//    now_t2_hours, read by lib/track.js) when it changed without a new check.
//    This counts what changed after the flag, not why: a dispatcher may have changed the quote for
//    another reason. Counts start on the day versions were first kept.
//
// 2. The "Quote Check" tick in ClickUp against the tool's verdict. In OBI's ClickUp sample the
//    box was ticked at done or invoiced (113 of 113 ticks), never at quote ready, so it looks like
//    a review later in the job, not the TL's check before sending. A red quote that was ticked is
//    one to look at: either that review does not look at Tech 2, or the flag was wrong.
import { crewCheckLine } from "./fieldline.js";
import { secondTechHours } from "./answer.js";
import { verdictOf } from "./clients.js";

const RED = "NO REASON";
const GREEN = new Set(["OSHA", "OK SAFETY", "OK TWO-PERSON", "ONE TECH"]);
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);

// Every known version of one task, oldest first: the stored versions, plus the latest check when
// it was made before versions were kept.
function versionsOf(row, versions) {
  const list = versions.filter((v) => v.task_id === row.task_id).map((v) => ({
    hash: v.quote_hash, verdict: verdictOf(v.line), line: v.line, t2: Number(v.t2_hours) || 0, at: v.checked_at,
  }));
  if (row.ok && row.answer && !list.some((v) => v.hash === row.quote_hash)) {
    const line = crewCheckLine(row.answer, row.quote);
    list.push({ hash: row.quote_hash, verdict: verdictOf(line), line, t2: secondTechHours(row.quote) || 0, at: row.checked_at });
  }
  return list.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// What became of one task after its first red version.
export function outcomeOf(row, versions) {
  const list = versionsOf(row, versions);
  const at = list.findIndex((v) => v.verdict === RED);
  if (at < 0) return { flagged: false, versions: list };
  const red = list[at];
  const later = list.slice(at + 1);
  const last = later[later.length - 1] || null;
  // The quote in ClickUp now, when it changed after the last check and was not checked again.
  const lastHash = list[list.length - 1].hash;
  const now = row.now_hash && row.now_hash !== lastHash && row.now_t2_hours != null ? Number(row.now_t2_hours) : null;
  const endT2 = now != null ? now : last ? last.t2 : red.t2;
  let how = null;
  if (endT2 < red.t2) how = endT2 === 0 ? "Tech 2 removed" : "Tech 2 hours cut";
  else if (last && GREEN.has(last.verdict) && now == null) how = "Reason added";
  return {
    flagged: true, fixed: !!how, how, unchecked_change: now != null,
    red_t2: red.t2, end_t2: endT2, hours_cut: round1(Math.max(0, red.t2 - endT2)),
    red_at: red.at, versions: list,
  };
}

export function impact(rows, versions) {
  const tasks = [];
  const qc = { known: 0, ticked: 0, red: 0, red_ticked: 0, green: 0, green_ticked: 0 };
  for (const r of rows) {
    if (!r.ok || !r.answer) continue;
    const o = outcomeOf(r, versions);
    const latest = o.versions[o.versions.length - 1]?.verdict || null;
    if (o.flagged) tasks.push({ task_id: r.task_id, task_name: r.task_name, task_url: r.task_url || null, fm: r.fm || null, status: r.status || null, quote_check: r.quote_check ?? null, ...o, versions: undefined, steps: o.versions.map((v) => ({ line: v.line, t2: v.t2, at: v.at })) });
    if (r.quote_check == null) continue;
    qc.known++;
    if (r.quote_check) qc.ticked++;
    // The verdict when the quote was last seen red stays red here unless it was fixed.
    const red = o.flagged && !o.fixed;
    if (red) { qc.red++; if (r.quote_check) qc.red_ticked++; }
    else if (latest && latest !== "ASK FIRST") { qc.green++; if (r.quote_check) qc.green_ticked++; }
  }
  const fixed = tasks.filter((t) => t.fixed);
  const totals = {
    flagged: tasks.length,
    fixed: fixed.length,
    fixed_share: pct(fixed.length, tasks.length),
    reason_added: fixed.filter((t) => t.how === "Reason added").length,
    t2_removed: fixed.filter((t) => t.how === "Tech 2 removed").length,
    t2_cut: fixed.filter((t) => t.how === "Tech 2 hours cut").length,
    hours_cut: round1(fixed.reduce((n, t) => n + t.hours_cut, 0)),
    still_red: tasks.length - fixed.length,
  };
  return {
    totals,
    quote_check: { ...qc, red_ticked_share: pct(qc.red_ticked, qc.red), green_ticked_share: pct(qc.green_ticked, qc.green) },
    // Fixed first, most hours cut first; then the ones still red, the ticked ones first.
    tasks: tasks.sort((a, b) => (b.fixed - a.fixed) || (b.hours_cut - a.hours_cut) || ((b.quote_check === true) - (a.quote_check === true)) || String(b.red_at).localeCompare(String(a.red_at))),
  };
}
