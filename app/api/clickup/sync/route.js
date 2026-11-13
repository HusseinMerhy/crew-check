// Vol 2: the daily automatic check. Vercel Cron calls this once a day (vercel.json). It reads the
// quotes waiting in ClickUp, runs each one through the same check as the page, and stores the
// answers for /queue. The only thing written back to ClickUp is the OSHA Check field, and only
// when CLICKUP_WRITE=on and the work order's list is in CLICKUP_WRITE_LISTS (lib/fieldwrite.js).
//
// Settings (Vercel): CRON_SECRET (Vercel sends it as a Bearer token on cron calls),
// CLICKUP_API_TOKEN, CLICKUP_TEAM_ID, DATABASE_URL, and optionally CLICKUP_SYNC_STATUSES.
// The passcode lock in middleware.js lets this one path through only with the cron secret.
// "Run now" on /queue calls it with ?manual=1, which is allowed only while the site passcode is
// on, so the person pressing it has already passed the lock.
import { POST as runCheck } from "../../check/route";
import { listTasks, getTask } from "../../../../lib/clickup";
import { tracker, followUp } from "../../../../lib/track";
import { ensureTables, syncQuotes } from "../../../../lib/sync";
import { fieldWriter } from "../../../../lib/fieldwrite";
import { getSql } from "../../../../lib/db";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_STATUSES = ["quote ready", "!! waiting for approval"];

export async function GET(req) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const fromCron = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  const manual = url.searchParams.get("manual") === "1" && !!process.env.SITE_PASSCODE;
  if (!fromCron && !manual) return Response.json({ ok: false, problem: "Not allowed: this runs from Vercel Cron, or from Run now while the site passcode is on." }, { status: 401 });

  const token = process.env.CLICKUP_API_TOKEN, team = process.env.CLICKUP_TEAM_ID, sql = getSql();
  const missing = [!token && "CLICKUP_API_TOKEN", !team && "CLICKUP_TEAM_ID", !sql && "DATABASE_URL"].filter(Boolean);
  if (missing.length) return Response.json({ ok: false, problem: `Automatic check is off: ${missing.join(", ")} not set in Vercel.` }, { status: 501 });

  await ensureTables(sql);

  const statuses = (process.env.CLICKUP_SYNC_STATUSES || "").split(",").map((s) => s.trim()).filter(Boolean);
  let history = null;
  try { history = process.env.ENTITY_HISTORY ? JSON.parse(process.env.ENTITY_HISTORY) : null; } catch { history = null; }

  let out;
  try {
    out = await syncQuotes({
      list: (page) => listTasks({ token, team, statuses: statuses.length ? statuses : DEFAULT_STATUSES, page }),
      sql, history, afterCheck: fieldWriter({ token }), track: tracker(sql),
      check: async (t) => {
        const res = await runCheck(new Request("http://internal/api/check", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: t.quote, state: t.state }),
        }));
        return res.json();
      },
    });
  } catch (e) {
    return Response.json({ ok: false, problem: `Could not read ClickUp: ${e.message}` }, { status: 502 });
  }
  // Quotes that have left the waiting statuses: read a few again (GET only, no new check), so the
  // Quote Check tick and a quote edited after approval are still seen (lib/track.js).
  try { out.followed = await followUp({ sql, getTask: (id) => getTask({ token, id }) }); }
  catch (e) { out.followed = { read: 0, problem: String(e?.message || e).slice(0, 200) }; }
  return Response.json({ ok: true, ...out });
}
