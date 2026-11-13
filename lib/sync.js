// Vol 2: the daily automatic check's loop, apart from the route so it can be tested with fakes
// (tests/vol2.test.mjs). It reads tasks through `list` (ClickUp, GET only), skips quotes already
// checked with the same text, checks the rest through `check` and stores each answer in auto_checks.
import { createHash } from "node:crypto";
import { taskFields } from "./clickup.js";
import { historyLine, jobOf } from "./history.js";
import { stripMoney } from "./money.js";

// One run checks at most this many quotes; the rest wait for the next run, newest first.
export const MAX_PER_RUN = 20;
const CONCURRENCY = 4;
const MAX_PAGES = 5;

export const hashOf = (t) => createHash("sha256").update(`${t.state}\n${t.quote}`).digest("hex");

// The table the checks live in, with every column added since the first run. Shared by the daily
// run, the webhook and the queue, so they cannot drift apart.
export async function ensureTables(sql) {
  await sql.query(`create table if not exists auto_checks (
    task_id text primary key, task_name text, task_url text, status text, entity text, fm text, state text,
    quote_hash text, headline text, answer text, history text, ok boolean, problem text, checked_at timestamptz default now())`);
  for (const col of ["job text", "quote text", "field_written_at timestamptz", "field_note text",
    // Fresh facts read on every run (lib/track.js): no amounts, the NTE is a state and a percent.
    "quote_check boolean", "nte_state text", "nte_pct integer", "now_hash text", "now_t2_hours numeric", "followed_at timestamptz"]) {
    await sql.query(`alter table auto_checks add column if not exists ${col}`);
  }
  // Every quote version checked, so a red quote fixed later can be counted (lib/impact.js).
  await sql.query(`create table if not exists check_versions (
    id bigserial primary key, task_id text not null, quote_hash text not null, line text, t2_hours numeric,
    status text, checked_at timestamptz default now(), unique (task_id, quote_hash))`);
}

// afterCheck (optional): called after a good check, and for a quote checked earlier whose field
// was never written, with (t, { answer }). It writes the OSHA Check field (lib/fieldwrite.js) and
// returns { written, note }, which is stored so the queue can show it. Left out when writing is off.
// track (optional, lib/track.js): told about every task read and every good check, and flushed at
// the end, so quote versions and fresh facts are kept without changing this loop's own queries.
export async function syncQuotes({ list, sql, check, history, afterCheck = null, track = null }) {
  let written = 0, notWritten = 0, lastNote = null;
  async function record(t, answer) {
    let w;
    try { w = await afterCheck(t, { answer }); } catch (e) { w = { written: false, note: String(e?.message || e).slice(0, 300) }; }
    if (w.written) written++;
    else if (w.note) { notWritten++; lastNote = w.note; }
    await sql.query(`update auto_checks set field_written_at = ${w.written ? "now()" : "null"}, field_note = $2 where task_id = $1`, [t.id, w.note || null]);
  }
  // Collect quotes that are new or changed since they were last checked.
  const todo = [];
  let seen = 0, noQuote = 0, unchanged = 0, more = false;
  scan: for (let page = 0; page < MAX_PAGES; page++) {
    const { tasks, last } = await list(page);
    for (const task of tasks) {
      const t = taskFields(task);
      if (t.quote.trim().length < 20) { seen++; noQuote++; continue; }
      t.hash = hashOf(t);
      t.job = jobOf(t.quote);
      track?.seen(task, t);
      const prev = await sql.query(`select quote_hash, job, quote, ok, answer, field_written_at from auto_checks where task_id = $1`, [t.id]);
      if (prev[0]?.quote_hash === t.hash) {
        // Rows checked before the job type and the quote were stored get them now, without a new check.
        if (!prev[0].job || !prev[0].quote) await sql.query(`update auto_checks set job = $2, quote = $3 where task_id = $1`, [t.id, t.job, stripMoney(t.quote)]);
        // Checked before writing was switched on: fill the field from the stored answer, no new check.
        if (afterCheck && prev[0].ok && prev[0].answer && !prev[0].field_written_at) await record(t, prev[0].answer);
        seen++; unchanged++; continue;
      }
      if (todo.length === MAX_PER_RUN) { more = true; break scan; }
      seen++;
      todo.push(t);
    }
    if (last) break;
    if (page === MAX_PAGES - 1) more = true;
  }

  // Same check as the page (keyword search: there is no browser here to build the meaning vector).
  async function checkOne(t) {
    let d;
    try { d = await check(t); } catch (e) { d = { ok: false, problem: String(e.message || e) }; }
    await sql.query(
      `insert into auto_checks (task_id, task_name, task_url, status, entity, fm, state, quote_hash, headline, answer, history, ok, problem, job, quote, checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       on conflict (task_id) do update set task_name=$2, task_url=$3, status=$4, entity=$5, fm=$6, state=$7, quote_hash=$8,
         headline=$9, answer=$10, history=$11, ok=$12, problem=$13, job=$14, quote=$15, checked_at=now()`,
      [t.id, t.name, t.url, t.status, t.entity || null, t.fm || null, t.state || null, d.ok ? t.hash : null,
        d.ok ? (d.answer || "").split("\n")[0] : null, d.ok ? d.answer : null, historyLine(history, t.entity, t.job, t.fm), !!d.ok, d.ok ? null : d.problem || "error", t.job, stripMoney(t.quote)]);
    if (d.ok && track) await track.checked(t, d.answer);
    if (d.ok && afterCheck) await record(t, d.answer);
    return d.ok;
  }
  let checked = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const results = await Promise.all(todo.slice(i, i + CONCURRENCY).map(checkOne));
    for (const ok of results) ok ? checked++ : failed++;
  }
  const tracked = track ? await track.flush() : null;
  return { seen, checked, failed, unchanged, no_quote: noQuote, left_for_next_run: more, field_written: written, field_not_written: notWritten, field_note: lastNote, ...(tracked ? { tracked } : {}) };
}

// Queue rows saved before quotes were stored have none. Fetch those straight from ClickUp (GET
// only, no new check, no model call) and save them, so the queue never waits for a daily run.
// An empty string means ClickUp has no quote on the task, so it is not fetched again.
export const FILL_PER_LOAD = 40;
export async function fillQuotes({ rows, getTask, sql, limit = FILL_PER_LOAD, concurrency = 6 }) {
  const missing = rows.filter((r) => r.quote == null).slice(0, limit);
  let filled = 0;
  for (let i = 0; i < missing.length; i += concurrency) {
    await Promise.all(missing.slice(i, i + concurrency).map(async (r) => {
      try {
        const t = taskFields(await getTask(r.task_id));
        r.quote = stripMoney(t.quote);
        r.job = r.job || (t.quote ? jobOf(t.quote) : null);
        await sql.query(`update auto_checks set quote = $2, job = coalesce(job, $3) where task_id = $1`, [r.task_id, r.quote, r.job]);
        filled++;
      } catch { /* left empty; tried again on the next page load */ }
    }));
  }
  return filled;
}
