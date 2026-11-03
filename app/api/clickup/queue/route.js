// Vol 2: the stored results of the daily automatic check, newest first, for /queue.
// Behind the site passcode like every other route.
import { getSql } from "../../../../lib/db";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set in Vercel." });
  try {
    const rows = await sql.query(
      `select task_id, task_name, task_url, status, entity, fm, state, headline, answer, history, ok, problem, checked_at
       from auto_checks order by checked_at desc limit 200`);
    return Response.json({ ok: true, rows, auto: !!process.env.CRON_SECRET, manual: !!process.env.SITE_PASSCODE });
  } catch (e) {
    // The table appears on the first run.
    return Response.json({ ok: true, rows: [], auto: !!process.env.CRON_SECRET, manual: !!process.env.SITE_PASSCODE });
  }
}
