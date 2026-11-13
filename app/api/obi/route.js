// OBI's connection to Quote Builder (lib/obi.js, docs/obi-handoff.md). Needs OBI_API_KEY in
// Vercel; OBI sends it as "Authorization: Bearer <key>". The passcode lock lets this path
// through only with that key, and the route checks it again.
//   GET  /api/obi?task=<ClickUp task id>             the verdict stored for that work order
//   POST /api/obi  { quote, state, nte? }            check this quote now (spends API credit)
import { POST as runCheck } from "../check/route";
import { getSql } from "../../../lib/db";
import { ensureTables } from "../../../lib/sync";
import { freshResult, obiRefusal, storedResult } from "../../../lib/obi";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const refuse = (req) => {
  const no = obiRefusal(req.headers.get("authorization"), process.env.OBI_API_KEY);
  return no ? Response.json(no.body, { status: no.status }) : null;
};

export async function GET(req) {
  const no = refuse(req);
  if (no) return no;
  const id = (new URL(req.url).searchParams.get("task") || "").trim();
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return Response.json({ ok: false, problem: "Give the ClickUp task id as ?task=" }, { status: 400 });
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, problem: "DATABASE_URL is not set in Vercel." }, { status: 501 });
  await ensureTables(sql);
  const rows = await sql.query(`select task_id, task_name, status, checked_at, answer, quote, ok, problem, quote_hash, now_hash,
    quote_check, nte_state, nte_pct from auto_checks where task_id = $1`, [id]);
  const out = storedResult(rows[0]);
  return Response.json(out, { status: rows[0] ? 200 : 404 });
}

export async function POST(req) {
  const no = refuse(req);
  if (no) return no;
  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false, problem: "Send JSON: { quote, state, nte }." }, { status: 400 }); }
  const quote = String(body?.quote || "");
  const res = await runCheck(new Request("http://internal/api/check", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote, state: body?.state || "" }),
  }));
  const d = await res.json();
  if (!d.ok) return Response.json({ ok: false, problem: d.problem || "The check failed." }, { status: res.status === 200 ? 502 : res.status });
  const nte = body?.nte != null && Number(body.nte) > 0 ? Number(body.nte) : null;
  return Response.json(freshResult({ answer: d.answer, quote, nte }));
}
