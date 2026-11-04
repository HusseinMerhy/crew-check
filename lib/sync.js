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

const hashOf = (t) => createHash("sha256").update(`${t.state}\n${t.quote}`).digest("hex");

export async function syncQuotes({ list, sql, check, history }) {
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
      const prev = await sql.query(`select quote_hash, job, quote from auto_checks where task_id = $1`, [t.id]);
      if (prev[0]?.quote_hash === t.hash) {
        // Rows checked before the job type and the quote were stored get them now, without a new check.
        if (!prev[0].job || !prev[0].quote) await sql.query(`update auto_checks set job = $2, quote = $3 where task_id = $1`, [t.id, t.job, stripMoney(t.quote)]);
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
        d.ok ? (d.answer || "").split("\n")[0] : null, d.ok ? d.answer : null, historyLine(history, t.entity, t.job), !!d.ok, d.ok ? null : d.problem || "error", t.job, stripMoney(t.quote)]);
    return d.ok;
  }
  let checked = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const results = await Promise.all(todo.slice(i, i + CONCURRENCY).map(checkOne));
    for (const ok of results) ok ? checked++ : failed++;
  }
  return { seen, checked, failed, unchanged, no_quote: noQuote, left_for_next_run: more };
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
