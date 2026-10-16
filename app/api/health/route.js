// Health check: confirms the Claude API key in Vercel works.
// Sends one tiny request. Never returns or logs the key itself.
import { getModel } from "../../../lib/model";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ ok: false, problem: "ANTHROPIC_API_KEY is not set in Vercel (or the site was not redeployed after adding it)." });
  }
  const { model, note } = getModel();
  if (!model) return Response.json({ ok: false, problem: note });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Reply with: ok" }] }),
    });
    if (r.ok) return Response.json({ ok: true, model, note, message: "Claude API key works." });
    const body = await r.json().catch(() => ({}));
    return Response.json({ ok: false, model, status: r.status, problem: body?.error?.type || "unknown", detail: body?.error?.message || "" });
  } catch (e) {
    return Response.json({ ok: false, problem: "network", detail: String(e).slice(0, 200) });
  }
}
