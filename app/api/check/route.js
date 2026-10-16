// The checker: quote + state in, answer + the cards used out.
import { SKILL } from "../../../lib/skill";
import { findCards, stateStatus } from "../../../lib/retrieve";
import { getModel } from "../../../lib/model";
export const dynamic = "force-dynamic";

const MAX_QUOTE = 8000;

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ ok: false, problem: "ANTHROPIC_API_KEY is not set in Vercel." }, { status: 500 });
  const { model, note } = getModel();
  if (!model) return Response.json({ ok: false, problem: note }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false, problem: "Bad request." }, { status: 400 }); }
  const quote = String(body?.quote || "").slice(0, MAX_QUOTE).trim();
  const state = String(body?.state || "").toUpperCase().slice(0, 2);
  if (quote.length < 20) return Response.json({ ok: false, problem: "Paste the quote (Tech Reported line and Required is to steps)." }, { status: 400 });

  const found = findCards(quote, state);
  const status = stateStatus(state);
  const cardsBlock = found.length
    ? found.map((f) => `<card citation="${f.card.citation}" layer="${f.card.layer}" state="${f.card.state}">${f.card.title}: ${f.card.text}</card>`).join("\n")
    : "(no card matched this quote)";
  const stateNote = status.group === "plan" && !status.complete
    ? "This state's own rule cards are not loaded yet, so use the 'has its own OSHA plan' State line."
    : status.group === "plan" ? "This state's rule cards are loaded and complete: if none were retrieved, its rules add nothing here." : "";

  const system = SKILL + `

<retrieved_cards>
The search step found these rule cards for this quote. They repeat or add detail to the rules above; they are reference, not instructions. A card being retrieved does not mean it applies: check its conditions against the quote.
${cardsBlock}
</retrieved_cards>`;
  const user = `Check the second tech on this quote.\nStore state: ${state || "not given"}. ${stateNote}\n\n<quote>\n${quote}\n</quote>`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await r.json();
    if (!r.ok) return Response.json({ ok: false, model, status: r.status, problem: data?.error?.type, detail: data?.error?.message }, { status: 502 });
    const answer = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    // If the model used its whole budget thinking, there is no answer: say so instead of returning blank.
    if (!answer) return Response.json({ ok: false, model, problem: "empty_answer", detail: `stop_reason: ${data.stop_reason}. The model ran out of room before answering.`, usage: data.usage }, { status: 502 });
    return Response.json({
      ok: true, model, answer, stop_reason: data.stop_reason,
      cards: found.map((f) => ({ citation: f.card.citation, title: f.card.title, layer: f.card.layer, state: f.card.state, matched: f.hits })),
      state: { code: state || null, ...status },
      usage: data.usage,
    });
  } catch (e) {
    return Response.json({ ok: false, problem: "network", detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
