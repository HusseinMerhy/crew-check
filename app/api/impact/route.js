// Vol 2: does the flag change anything, for /fixes. Behind the site passcode like every other
// route. Worked out in code from this app's own tables (lib/impact.js): no model call, and
// nothing is read from or written to ClickUp here.
import { getSql } from "../../../lib/db";
import { ensureTables } from "../../../lib/sync";
import { impact } from "../../../lib/impact";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set in Vercel." });
  try {
    await ensureTables(sql);
    const rows = await sql.query(`select task_id, task_name, task_url, fm, status, quote_hash, answer, quote, ok, checked_at,
      quote_check, now_hash, now_t2_hours, followed_at from auto_checks`);
    const versions = await sql.query(`select task_id, quote_hash, line, t2_hours, status, checked_at from check_versions order by checked_at`);
    const since = versions.reduce((m, v) => (!m || v.checked_at < m ? v.checked_at : m), null);
    const followed = rows.filter((r) => r.followed_at).length;
    return Response.json({ ok: true, ...impact(rows, versions), since, followed, checked: rows.filter((r) => r.ok).length });
  } catch (e) {
    return Response.json({ ok: false, problem: `Could not read the checks: ${String(e?.message || e).slice(0, 200)}` });
  }
}
