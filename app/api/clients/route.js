// Vol 2: patterns per client for /clients, behind the site passcode like every other route.
// Built in code from the stored checks and ENTITY_HISTORY (lib/clients.js); no model call, and
// nothing is read from or written to ClickUp here.
import { getSql } from "../../../lib/db";
import { clientPatterns, clientTotals } from "../../../lib/clients";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set in Vercel." });
  let history = null;
  try { history = process.env.ENTITY_HISTORY ? JSON.parse(process.env.ENTITY_HISTORY) : null; } catch { history = null; }
  try {
    const rows = await sql.query(`select task_id, task_name, task_url, fm, entity, job, answer, quote, ok, checked_at, nte_state, nte_pct from auto_checks`);
    const clients = clientPatterns(rows, history);
    const since = rows.reduce((m, r) => (!m || r.checked_at < m ? r.checked_at : m), null);
    return Response.json({ ok: true, clients, totals: clientTotals(clients), since, history_built: history?.built || null });
  } catch {
    // No checks stored yet: the table appears on the first daily run.
    return Response.json({ ok: true, clients: [], totals: clientTotals([]), since: null, history_built: history?.built || null });
  }
}
