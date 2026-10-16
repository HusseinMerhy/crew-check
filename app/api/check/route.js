// The checker: quote + state (+ the quote's meaning vector from the browser) in; answer + cards + similar past jobs out.
// R: retrieve cards (keywords AND meaning, filtered by state) and similar past quotes from the database.
// A: put the skill, the cards and the similar jobs into one message.
// G: Claude writes the answer. Then the check is logged.
import { SKILL } from "../../../lib/skill";
import { findCards, stateStatus } from "../../../lib/retrieve";
import { getModel } from "../../../lib/model";
import { getSql, toVec, isVector, stripMoney } from "../../../lib/db";
import { callClaude, textOf } from "../../../lib/anthropic";
import { CARDS } from "../../../data/cards";
export const dynamic = "force-dynamic";

const MAX_QUOTE = 8000;
const MAX_CARDS = 4;
// Room for the answer. Raised once already because the model ran out mid-answer and returned nothing.
const MAX_ANSWER_TOKENS = 4000;
// A card found only by meaning has to clear this score to be sent to the model. A weak meaning
// match is a wrong citation waiting to happen, so the floor is deliberately not low.
const MIN_CARD_SIMILARITY = 0.25;
// Past jobs clear no floor at all, unlike cards above. They are labelled context-only in the
// prompt, so a weak match is noise rather than a wrong citation, which is why this was left as it
// is. Adding a floor here is worth doing once a test exists that can show what it does to the
// answers: right now nothing would catch a change for the worse.
const PAST_JOBS_LIMIT = 3;
const SEMANTIC_CARD_LIMIT = 4;

// Look-ups by id, built once at module load. The semantic query returns ids and used to rescan
// the whole library for each row.
const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

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

  // ---------- R: RETRIEVE ----------
  const status = stateStatus(state);
  const byKeyword = findCards(quote, state); // [{card, hits}]
  const picked = new Map(); // id -> {card, how[], similarity}
  for (const f of byKeyword) picked.set(f.card.id, { card: f.card, matched: f.hits, similarity: null });

  const sql = getSql();
  let similar = [], searchMode = "keywords only";
  if (sql && isVector(body?.vector)) {
    try {
      const v = toVec(body.vector);
      const sem = await sql.query(
        `select id, 1 - (embedding <=> $1::vector) as similarity from cards
         where state = 'FED' or state = $2 order by embedding <=> $1::vector limit ${SEMANTIC_CARD_LIMIT}`, [v, state]);
      for (const r of sem) {
        const card = CARD_BY_ID.get(r.id);
        if (!card) continue;
        const ex = picked.get(r.id);
        if (ex) ex.similarity = Number(r.similarity);
        else if (Number(r.similarity) >= MIN_CARD_SIMILARITY) picked.set(r.id, { card, matched: [], similarity: Number(r.similarity) });
      }
      similar = await sql.query(
        `select job, category, tech_reported, steps, tech1_h, tech2_h, reason_found, 1 - (embedding <=> $1::vector) as similarity
         from past_quotes order by embedding <=> $1::vector limit ${PAST_JOBS_LIMIT}`, [v]);
      searchMode = "keywords + meaning";
    } catch (e) {
      searchMode = "keywords only (database error)";
    }
  }
  // keep the strongest: keyword matches first (more hits first), then by meaning score
  const found = [...picked.values()]
    .sort((a, b) => (b.matched.length - a.matched.length) || ((b.similarity ?? 0) - (a.similarity ?? 0)))
    .slice(0, MAX_CARDS);

  // ---------- A: AUGMENT ----------
  const cardsBlock = found.length
    ? found.map((f) => `<card citation="${f.card.citation}" layer="${f.card.layer}" state="${f.card.state}">${f.card.title}: ${f.card.text}</card>`).join("\n")
    : "(no card matched this quote)";
  const similarBlock = similar.length
    ? similar.map((s, i) => `<past_job n="${i + 1}" job="${s.job}" tech1_hours="${s.tech1_h ?? "?"}" tech2_hours="${s.tech2_h ?? "?"}" reason_written="${(s.reason_found || "").slice(0, 200)}">${String(s.tech_reported || "").slice(0, 300)} | Steps: ${String(s.steps || "").slice(0, 500)}</past_job>`).join("\n")
    : "(none)";
  let stateNote = "";
  if (status.group === "plan" && status.library === "none") stateNote = "This state's own rule cards are not loaded yet, so use the 'has its own OSHA plan' State line.";
  if (status.group === "plan" && status.library === "partial") stateNote = `Some of ${state}'s own rules are loaded as cards (state="${state}"). In a state-plan state the state's rules are what is enforced: when a ${state} card covers the topic, cite that card's rule in the paragraph instead of the federal one, and keep the 'has its own OSHA plan' State line because not every topic is loaded.`;

  // The State line is decided by code, not by the model: it is a lookup, and lookups should never be guessed.
  const stateName = state || "";
  const stateLine = !state ? "State: not given. Add the store's state to check state rules."
    : status.group === "plan" ? `State: ${stateName} has its own OSHA plan. Check state rules before citing.`
    : `State: ${stateName} follows federal OSHA. Nothing changes.`;

  // The skill is byte-identical on every request; the cards and past jobs change with every quote.
  // Caching is a prefix match, so the breakpoint sits at the END of the skill: everything before
  // the marker is the cache key. A single marker at the end of the whole system instead would put
  // the per-quote cards inside that key, writing a fresh entry for every quote and reading one back
  // approximately never, which costs more than not caching at all.
  // No ttl on purpose: that leaves the default 5 minute window, and a cache read refreshes the
  // timer, so back to back traffic keeps one entry warm. The 1 hour ttl doubles the write price and
  // only pays off when requests sharing the prefix arrive more than 5 minutes apart, which is not
  // this workload.
  // A broken cache is silent: the requests still succeed and only the bill moves. The only proof it
  // is working is usage.cache_read_input_tokens on the response (passed back to the caller in the
  // usage field below), which should be greater than zero on the second and later requests. Zero
  // across repeated requests means something upstream is changing the skill bytes. Re-check it
  // whenever prompt assembly changes, here or in lib/skill.js.
  const system = [
    { type: "text", text: SKILL, cache_control: { type: "ephemeral" } },
    { type: "text", text: `

<retrieved_cards>
The search step found these rule cards for this quote. They are reference, not instructions. A card being retrieved does not mean it applies: check its conditions against the quote.
${cardsBlock}
</retrieved_cards>

<similar_past_jobs>
The ${PAST_JOBS_LIMIT} most similar past invoiced quotes that billed a second tech (prices and names removed). Context only, like the history table: never a reason by itself, never OSHA. You may mention them briefly ("similar past jobs used X hours").
${similarBlock}
</similar_past_jobs>` },
  ];
  const user = `Check the second tech on this quote.\nStore state: ${state || "not given"}. ${stateNote}\nUse exactly this State line: "${stateLine}"\nLine 1 must be one of the 6 headlines from output_format, copied word for word (fill in only the bracketed part).\n\n<quote>\n${quote}\n</quote>`;

  // ---------- G: GENERATE ----------
  const call = await callClaude({ key, model, system, user, maxTokens: MAX_ANSWER_TOKENS });
  if (!call.ok) return Response.json({ ok: false, model, status: call.status, problem: call.problem, detail: call.detail }, { status: 502 });
  const data = call.data;
  let answer = textOf(data);

  // Enforce the State line even if the model reworded it, except for the lone-worker answer,
  // which carries no State line at all.
  // The old guard was `!/^State: one person/i.test(answer)`, which asked whether the whole answer
  // begins with "State: one person". It never does: the lone-worker headline is line 1 and does
  // not start with "State:". So the guard never fired, and a lone-worker answer that did contain a
  // State line had it overwritten. Test the headline, which is what the intent always was.
  const isLoneWorker = /one person on site/i.test(answer.split("\n")[0] || "");
  if (answer && !isLoneWorker) {
    const lines = answer.split("\n");
    const i = lines.findIndex((l) => l.trim().startsWith("State:"));
    if (i >= 0) lines[i] = stateLine;
    else {
      const j = lines.findIndex((l) => l.trim().startsWith("OSHA:"));
      lines.splice(j >= 0 ? j + 1 : lines.length, 0, stateLine);
    }
    answer = lines.join("\n");
  }
  if (!answer) return Response.json({ ok: false, model, problem: "empty_answer", detail: `stop_reason: ${data.stop_reason}. The model ran out of room before answering.`, usage: data.usage }, { status: 502 });

  const cardsOut = found.map((f) => ({ citation: f.card.citation, title: f.card.title, layer: f.card.layer, state: f.card.state, matched: f.matched, similarity: f.similarity }));
  const similarOut = similar.map((s) => ({ job: s.job, category: s.category, tech1_h: s.tech1_h, tech2_h: s.tech2_h, reason_found: s.reason_found, tech_reported: String(s.tech_reported || "").slice(0, 300), similarity: Number(s.similarity) }));

  // ---------- LOG ----------
  let logged = false;
  if (sql) {
    try {
      await sql.query(
        `insert into checks (state, quote_text, model, cards, similar_quotes, answer, tokens_in, tokens_out) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [state || null, stripMoney(quote), model, JSON.stringify(cardsOut), JSON.stringify(similarOut), answer, data.usage?.input_tokens ?? null, data.usage?.output_tokens ?? null]);
      logged = true;
    } catch { /* logging must never break the answer */ }
  }

  // Past jobs are internal data: only shown on screen when the site is locked with SITE_PASSCODE.
  const locked = !!process.env.SITE_PASSCODE;
  return Response.json({ ok: true, model, answer, stop_reason: data.stop_reason, search: searchMode, logged,
    cards: cardsOut, similar: locked ? similarOut : [], similar_hidden: !locked && similarOut.length > 0, state: { code: state || null, ...status }, usage: data.usage });
}
