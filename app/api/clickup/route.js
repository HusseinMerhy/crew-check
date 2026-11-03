// Vol 2: import one quote from ClickUp by its task link or WO number, READ ONLY.
// ClickUp is read-only for this project: this route only ever sends GET requests, and there is
// no code here that creates, edits, moves or comments on anything.
// It returns only the fields the check needs. The task description is never read: work orders
// have carried payment details there.
//
// Settings (Vercel): CLICKUP_API_TOKEN (required), CLICKUP_TEAM_ID (needed for WO-1234 style ids).
import { parseTaskRef, taskFields } from "../../../lib/clickup";
export const dynamic = "force-dynamic";

const API = "https://api.clickup.com/api/v2";
const TIMEOUT_MS = 10000;

export async function GET(req) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return Response.json({ ok: false, problem: "ClickUp import is off: CLICKUP_API_TOKEN is not set in Vercel." }, { status: 501 });
  const ref = parseTaskRef(new URL(req.url).searchParams.get("task"));
  if (!ref) return Response.json({ ok: false, problem: "Paste a ClickUp task link, a task id, or a WO number such as WO-2338." }, { status: 400 });
  const team = process.env.CLICKUP_TEAM_ID;
  if (ref.custom && !team) return Response.json({ ok: false, problem: "WO numbers need CLICKUP_TEAM_ID in Vercel. Paste the task link instead." }, { status: 400 });

  const q = ref.custom ? `?custom_task_ids=true&team_id=${encodeURIComponent(team)}` : "";
  let r;
  try {
    r = await fetch(`${API}/task/${encodeURIComponent(ref.id)}${q}`, {
      method: "GET",
      headers: { Authorization: token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return Response.json({ ok: false, problem: e?.name === "TimeoutError" ? "ClickUp did not answer in time." : "Could not reach ClickUp." }, { status: 502 });
  }
  if (r.status === 401) return Response.json({ ok: false, problem: "ClickUp refused the token in CLICKUP_API_TOKEN." }, { status: 502 });
  if (r.status === 404) return Response.json({ ok: false, problem: "No ClickUp task with that id." }, { status: 404 });
  if (!r.ok) return Response.json({ ok: false, problem: `ClickUp answered ${r.status}.` }, { status: 502 });

  const t = taskFields(await r.json());
  return Response.json({
    ok: true,
    task: { id: t.id, name: t.name, url: t.url, status: t.status },
    quote: t.quote,
    state: t.state,
    entity: t.entity,
    fm: t.fm,
  });
}
