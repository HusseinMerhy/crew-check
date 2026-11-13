// What happens to a quote after the tool flags it. Two records, both in this app's own database:
//   - check_versions: one row per quote version checked, with its OSHA Check line and Tech 2
//     hours, so a red quote that is edited and checked again shows up as fixed (lib/impact.js).
//     auto_checks keeps only the latest version; this keeps every one.
//   - fresh facts on auto_checks, read on every run from the task as ClickUp has it now: status,
//     the "Quote Check" tick, the NTE result, and the quote's current hash and Tech 2 hours, so a
//     quote changed after it left the waiting statuses is still seen.
// ClickUp is only read here (GET). Plugged into syncQuotes as `track`, so the loop's own database
// calls stay as they are.
import { crewCheckLine } from "./fieldline.js";
import { secondTechHours } from "./answer.js";
import { liveFacts } from "./quotefacts.js";
import { taskFields } from "./clickup.js";
import { hashOf } from "./sync.js";
// The tables and columns are created by ensureTables in lib/sync.js, with the rest.

// One update for many tasks. Arrays go in as parameters, so nothing from ClickUp is ever pasted
// into the SQL text.
export async function saveFacts(sql, facts) {
  if (!facts.length) return 0;
  const col = (k) => facts.map((f) => f[k] ?? null);
  await sql.query(
    `update auto_checks a set status = coalesce(v.status, a.status), quote_check = v.qc, nte_state = v.ns, nte_pct = v.np,
       now_hash = v.nh, now_t2_hours = v.t2, followed_at = now()
     from (select unnest($1::text[]) id, unnest($2::text[]) status, unnest($3::boolean[]) qc, unnest($4::text[]) ns,
                  unnest($5::int[]) np, unnest($6::text[]) nh, unnest($7::numeric[]) t2) v
     where a.task_id = v.id`,
    [col("id"), col("status"), col("quote_check"), col("nte_state"), col("nte_pct"), col("now_hash"), col("now_t2_hours")]);
  return facts.length;
}

export async function saveVersion(sql, t, answer) {
  await sql.query(
    `insert into check_versions (task_id, quote_hash, line, t2_hours, status) values ($1, $2, $3, $4, $5)
     on conflict (task_id, quote_hash) do nothing`,
    [t.id, t.hash, crewCheckLine(answer, t.quote), secondTechHours(t.quote) || 0, t.status || null]);
}

// The `track` object syncQuotes takes. Facts are saved at the end of the run, after every new
// row exists. A failure here is kept quiet: it must never stop a check.
export function tracker(sql) {
  const facts = new Map();
  let problem = null;
  return {
    seen(task, t) { try { facts.set(t.id, liveFacts(task, t, hashOf)); } catch (e) { problem = String(e?.message || e); } },
    async checked(t, answer) { try { await saveVersion(sql, t, answer); } catch (e) { problem = String(e?.message || e); } },
    async flush() {
      try { await saveFacts(sql, [...facts.values()]); } catch (e) { problem = String(e?.message || e); }
      return { facts: facts.size, problem };
    },
  };
}

// Quotes checked earlier that have left the waiting statuses are not in the daily list any more.
// Read a few of them again (GET only, no new check, no model call), so the Quote Check tick, which
// is ticked later in the job, and a quote edited after approval are still seen.
export const FOLLOW_PER_RUN = 25;
export async function followUp({ sql, getTask, skip = [], limit = FOLLOW_PER_RUN, concurrency = 5, days = 60 }) {
  const rows = await sql.query(
    `select task_id from auto_checks
     where ok and checked_at > now() - make_interval(days => $3::int)
       and (followed_at is null or followed_at < now() - interval '2 days') and not (task_id = any($1::text[]))
     order by followed_at nulls first, checked_at desc limit $2`, [skip, limit, days]);
  const facts = [], gone = [];
  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(rows.slice(i, i + concurrency).map(async ({ task_id }) => {
      try {
        const task = await getTask(task_id);
        facts.push(liveFacts(task, taskFields(task), hashOf));
      } catch {
        gone.push(task_id);
      }
    }));
  }
  await saveFacts(sql, facts);
  // A task ClickUp would not show (deleted, or moved where the token cannot see) is tried again later.
  if (gone.length) await sql.query(`update auto_checks set followed_at = now() where task_id = any($1::text[])`, [gone]);
  return { read: facts.length, not_read: gone.length };
}
