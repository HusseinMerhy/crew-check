// Vol 2: the ClickUp webhook. A ClickUp Automation calls this the moment a quote reaches a waiting
// status ("quote ready", "!! waiting for approval"), so the quote is checked within seconds instead
// of at the next daily run. The daily run stays as the safety net for a missed call.
//
//   POST /api/clickup/webhook?secret=<WEBHOOK_SECRET>     body: the task, as ClickUp sends it
//
// READ ONLY on ClickUp: this route reads the task (GET) and writes only to this app's own
// database. It answers at once and checks after the answer, so ClickUp never waits on the model.
// Settings (Vercel): WEBHOOK_SECRET, plus what the daily check already uses (CLICKUP_API_TOKEN,
// DATABASE_URL, ENTITY_HISTORY, optional CLICKUP_SYNC_STATUSES).
import { after } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { POST as runCheck } from "../../check/route";
import { getTask } from "../../../../lib/clickup";
import { syncQuotes } from "../../../../lib/sync";
import { getSql } from "../../../../lib/db";
import { isWaiting, taskIdOf, waitingStatuses } from "../../../../lib/webhook";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Compare digests so the time taken says nothing about how much of a guess was right.
const same = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

// The secret check shared by POST and GET. Null when the call may go on.
function refuse(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return Response.json({ ok: false, problem: "The webhook is off: WEBHOOK_SECRET is not set in Vercel." }, { status: 501 });
  const given = new URL(req.url).searchParams.get("secret") || req.headers.get("x-crew-check-secret") || "";
  if (!same(given, secret)) return Response.json({ ok: false, problem: "Wrong or missing secret." }, { status: 401 });
  return null;
}

// ClickUp's "Test" button, and a browser opening the address, only need to hear that the address
// works. With the right secret this says so; nothing is read or checked.
export async function GET(req) {
  return refuse(req) || Response.json({ ok: true, ready: true });
}

export async function POST(req) {
  const no = refuse(req);
  if (no) return no;

  const token = process.env.CLICKUP_API_TOKEN, sql = getSql();
  if (!token || !sql) return Response.json({ ok: false, problem: "CLICKUP_API_TOKEN or DATABASE_URL is not set in Vercel." }, { status: 501 });

  let body;
  try { body = await req.json(); } catch { body = null; }
  const id = taskIdOf(body);
  // A test call carries no task. Answer OK, so the sender sees the address works; there is
  // simply nothing to check.
  if (!id) return Response.json({ ok: true, test: true, note: "No task in the call: nothing to check." });

  after(async () => {
    try {
      const task = await getTask({ token, id });
      if (!isWaiting(task, waitingStatuses())) return; // moved on already: nothing to check
      let history = null;
      try { history = process.env.ENTITY_HISTORY ? JSON.parse(process.env.ENTITY_HISTORY) : null; } catch { history = null; }
      await sql.query(`create table if not exists auto_checks (
        task_id text primary key, task_name text, task_url text, status text, entity text, fm text, state text,
        quote_hash text, headline text, answer text, history text, ok boolean, problem text, checked_at timestamptz default now())`);
      await sql.query(`alter table auto_checks add column if not exists job text`);
      await sql.query(`alter table auto_checks add column if not exists quote text`);
      // The same loop as the daily run, given just this one task: it skips a quote already
      // checked with the same text and stores the answer for the queue.
      await syncQuotes({
        list: async () => ({ tasks: [task], last: true }),
        sql, history,
        check: async (t) => (await runCheck(new Request("http://internal/api/check", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: t.quote, state: t.state }),
        }))).json(),
      });
    } catch (e) {
      console.error("webhook check failed", id, e?.message || e);
    }
  });
  return Response.json({ ok: true, accepted: id }, { status: 202 });
}
