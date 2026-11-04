// Vol 2: the stored results of the daily automatic check, newest first, for /queue.
// Behind the site passcode like every other route.
// Each row's history line is redrawn here from the current ENTITY_HISTORY, so loading newer
// numbers in Vercel updates every row at once. A row checked before the job type was stored keeps
// the line it was saved with until the next daily run fills its job in.
import { getSql } from "../../../../lib/db";
import { historyLine } from "../../../../lib/history";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  const flags = { auto: !!process.env.CRON_SECRET, manual: !!process.env.SITE_PASSCODE };
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set in Vercel." });
  let history = null;
  try { history = process.env.ENTITY_HISTORY ? JSON.parse(process.env.ENTITY_HISTORY) : null; } catch { history = null; }
  try {
    await sql.query(`alter table auto_checks add column if not exists job text`);
    await sql.query(`alter table auto_checks add column if not exists quote text`);
    const rows = await sql.query(
      `select task_id, task_name, task_url, status, entity, fm, state, headline, answer, history, job, quote, ok, problem, checked_at
       from auto_checks order by checked_at desc limit 200`);
    for (const r of rows) r.history = (r.job && historyLine(history, r.entity, r.job)) || r.history;
    return Response.json({ ok: true, rows, ...flags, history_entities: Object.keys(history?.entities || {}), history_built: history?.built || null });
  } catch (e) {
    // The table appears on the first run.
    return Response.json({ ok: true, rows: [], ...flags });
  }
}
