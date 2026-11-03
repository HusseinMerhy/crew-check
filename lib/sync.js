// Vol 2: the daily automatic check's loop, apart from the route so it can be tested with fakes
// (tests/vol2.test.mjs). It reads tasks through `list` (ClickUp, GET only), skips quotes already
// checked with the same text, checks the rest through `check` and stores each answer in auto_checks.
import { createHash } from "node:crypto";
import { taskFields } from "./clickup.js";
import { ENTITIES, lookup } from "./history.js";

// One run checks at most this many quotes; the rest wait for the next run, newest first.
export const MAX_PER_RUN = 20;
const CONCURRENCY = 4;
const MAX_PAGES = 5;

const hashOf = (t) => createHash("sha256").update(`${t.state}\n${t.quote}`).digest("hex");

function historyLine(history, t) {
  if (!history || !t.entity) return null;
  const h = lookup(history, t.entity, t.quote);
  const label = ENTITIES.find((e) => e.code === t.entity)?.label || t.entity;
  if (!h.entity) return null;
  return `${label} quoted a second tech on ${h.entity.t2}% of ${h.entity.n} past ${h.job.toLowerCase()} quotes` +
    (h.everyone ? ` (all entities: ${h.everyone.t2}%)` : "") + ".";
}

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
      const prev = await sql.query(`select quote_hash from auto_checks where task_id = $1`, [t.id]);
      if (prev[0]?.quote_hash === t.hash) { seen++; unchanged++; continue; }
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
      `insert into auto_checks (task_id, task_name, task_url, status, entity, fm, state, quote_hash, headline, answer, history, ok, problem, checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       on conflict (task_id) do update set task_name=$2, task_url=$3, status=$4, entity=$5, fm=$6, state=$7, quote_hash=$8,
         headline=$9, answer=$10, history=$11, ok=$12, problem=$13, checked_at=now()`,
      [t.id, t.name, t.url, t.status, t.entity || null, t.fm || null, t.state || null, d.ok ? t.hash : null,
        d.ok ? (d.answer || "").split("\n")[0] : null, d.ok ? d.answer : null, historyLine(history, t), !!d.ok, d.ok ? null : d.problem || "error"]);
    return d.ok;
  }
  let checked = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const results = await Promise.all(todo.slice(i, i + CONCURRENCY).map(checkOne));
    for (const ok of results) ok ? checked++ : failed++;
  }
  return { seen, checked, failed, unchanged, no_quote: noQuote, left_for_next_run: more };
}
