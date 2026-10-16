// Health check: confirms the Claude API key in Vercel works.
// Sends one tiny request. Never returns or logs the key itself.
import { getModel } from "../../../lib/model";
import { callClaude } from "../../../lib/anthropic";
export const dynamic = "force-dynamic";

// A health check that hangs for a minute is not a health check, so it waits far less than /api/check.
const HEALTH_TIMEOUT_MS = 15000;

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ ok: false, problem: "ANTHROPIC_API_KEY is not set in Vercel (or the site was not redeployed after adding it)." });
  }
  const { model, note } = getModel();
  if (!model) return Response.json({ ok: false, problem: note });
  const call = await callClaude({ key, model, user: "Reply with: ok", maxTokens: 5, timeoutMs: HEALTH_TIMEOUT_MS });
  if (call.ok) return Response.json({ ok: true, model, note, message: "Claude API key works." });
  return Response.json({ ok: false, model, status: call.status, problem: call.problem, detail: call.detail });
}
