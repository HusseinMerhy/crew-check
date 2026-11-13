// Find the missing two-person reason in a pasted conversation with the tech (lib/reason.js).
// Behind the site passcode like every other route. One small model call; reads nothing from
// ClickUp and writes nothing anywhere.
import { getModel } from "../../../lib/model";
import { callClaude, textOf } from "../../../lib/anthropic";
import { MAX_CONVERSATION, REASON_SYSTEM, readReason, reasonUser } from "../../../lib/reason";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ ok: false, problem: "ANTHROPIC_API_KEY is not set in Vercel." }, { status: 500 });
  const { model, note } = getModel();
  if (!model) return Response.json({ ok: false, problem: note }, { status: 500 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false, problem: "Bad request." }, { status: 400 }); }
  const quote = String(body?.quote || "");
  const conversation = String(body?.conversation || "").trim();
  if (conversation.length < 30) return Response.json({ ok: false, problem: "Paste the call transcript or the texts with the tech." }, { status: 400 });
  if (conversation.length > MAX_CONVERSATION) return Response.json({ ok: false, problem: `Paste at most ${MAX_CONVERSATION.toLocaleString("en-US")} characters: the part about this job.` }, { status: 400 });

  const r = await callClaude({ key, model, system: REASON_SYSTEM, user: reasonUser(quote, conversation), maxTokens: 1500, timeoutMs: 45000 });
  if (!r.ok) return Response.json({ ok: false, problem: `The model did not answer (${r.problem}). Try again.` }, { status: 502 });
  if (r.data?.stop_reason === "refusal") return Response.json({ ok: true, found: false, words: "", step: "", note: "The model declined this one. Read the conversation yourself." });
  return Response.json({ ok: true, ...readReason(textOf(r.data), conversation) });
}
