// Agentic retrieval experiment: Option C in the RAG vs agentic comparison report (DR-001).
// Off unless the deployment sets AGENTIC_RETRIEVAL=on AND the request asks for mode "agentic";
// the screen never asks, so users keep the fixed pipeline either way.
//
// The fixed pipeline's search still runs first and the model starts from the same cards. On top of
// that it may call one read-only tool, search_cards, to look for more cards in the same reviewed
// library with its own wording. That is the only difference from the fixed pipeline, so a score
// difference between the two measures what model-written searches add. No web, no ClickUp, no
// writes: a card the library does not hold cannot be found this way.
//
// Each step re-sends the whole conversation, so cost grows with every search; the cap below bounds
// it. The tools array renders before the system prompt, so this path has its own cache entry for
// the skill prefix, separate from the fixed pipeline's.
//
// runAgentic never throws, like callClaude. It answers { ok: true, ... } or { ok: false, reason, ... }
// and the caller falls back to the fixed pipeline on ok: false. The model call and the card search
// are passed in, so this file can be tested without the network or the card data.
import { textOf } from "./anthropic.js";

export const MAX_TOOL_CALLS = 4;
// One whole check, all steps included. The platform's function time limit has not been checked.
export const AGENTIC_BUDGET_MS = 60000;
const MAX_QUERY = 200;

export const SEARCH_CARDS_TOOL = {
  name: "search_cards",
  description: "Search the reviewed rule card library by keyword (federal cards and this store's state only). Returns the matching cards that are not already in retrieved_cards, with citation and rule text. Call it when the quote describes work a rule card might cover and retrieved_cards has no card for it. Do not call it to re-check a card you already have.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "A few words a technician would write about the work, for example \"welding inside a tank\" or \"ladder in the aisle\"." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  strict: true,
};

// Appended to the system prompt after the cached skill, so the skill bytes stay identical.
export const AGENTIC_NOTE = `

<search_tool>
You can call search_cards to look for rule cards the search step may have missed. It searches the same reviewed library by keyword, federal cards and this store's state only. Use it when the quote describes work a rule card could cover and retrieved_cards has no card for it, with the words a technician would write (for example "tank", "torch", "ladder", "harness", "480 volts"). At most ${MAX_TOOL_CALLS} searches.
Cite only rules from cards you were given or from this skill, as before. When you are done searching, write the answer in output_format with the headline on line 1, and do not describe the searches.
</search_tool>`;

// The <card> line the model sees, shared with the fixed pipeline's <retrieved_cards> block.
export const cardTag = (c) => `<card citation="${c.citation}" layer="${c.layer}" state="${c.state}">${c.title}: ${c.text}</card>`;

export function addUsage(total, u) {
  return {
    input_tokens: (total?.input_tokens || 0) + (u?.input_tokens || 0),
    output_tokens: (total?.output_tokens || 0) + (u?.output_tokens || 0),
    cache_read_input_tokens: (total?.cache_read_input_tokens || 0) + (u?.cache_read_input_tokens || 0),
    cache_creation_input_tokens: (total?.cache_creation_input_tokens || 0) + (u?.cache_creation_input_tokens || 0),
  };
}

// callModel({ messages, tools, toolChoice, timeoutMs }) -> callClaude's { ok, data } / { ok: false, ... }
// searchCards(query) -> [{ card, hits }] from findCards, already limited to federal + the store's state
// seenIds: ids of the cards already in the prompt
export async function runAgentic({ callModel, searchCards, user, seenIds = [], maxToolCalls = MAX_TOOL_CALLS, budgetMs = AGENTIC_BUDGET_MS, now = Date.now }) {
  const deadline = now() + budgetMs;
  const messages = [{ role: "user", content: user }];
  const seen = new Set(seenIds);
  const extraCards = [];
  const toolCalls = [];
  let usage = addUsage(null, null);
  let calls = 0;
  const fail = (reason) => ({ ok: false, reason, usage, calls, toolCalls, extraCards });

  for (;;) {
    const left = deadline - now();
    if (left <= 0) return fail("time budget used up");
    // At the cap the model may not search again, so the next answer has to be the final one.
    const atCap = toolCalls.length >= maxToolCalls;
    const call = await callModel({ messages, tools: [SEARCH_CARDS_TOOL], toolChoice: { type: atCap ? "none" : "auto" }, timeoutMs: left });
    calls++;
    if (!call.ok) return fail(`model call failed: ${call.problem}`);
    const data = call.data;
    usage = addUsage(usage, data.usage);

    if (data.stop_reason === "end_turn") {
      const answer = textOf(data);
      if (!answer) return fail("empty answer");
      return { ok: true, data, answer, usage, calls, toolCalls, extraCards };
    }
    // max_tokens can cut a tool call off mid-input and refusal means stop: never run that turn's tools.
    if (data.stop_reason !== "tool_use") return fail(`stop_reason ${data.stop_reason}`);
    // tool_choice "none" should make this impossible; if it happens anyway, stop rather than loop
    // until the time budget runs out, paying for every call.
    if (atCap) return fail("tool call after the search limit");
    const uses = (data.content || []).filter((b) => b.type === "tool_use");
    if (!uses.length) return fail("tool_use stop with no tool call");

    // The whole response goes back unchanged, thinking blocks included: the API checks them.
    messages.push({ role: "assistant", content: data.content });
    const results = uses.map((b) => {
      if (toolCalls.length >= maxToolCalls) return { type: "tool_result", tool_use_id: b.id, is_error: true, content: "Search limit reached. Answer with the cards you have." };
      const query = typeof b.input?.query === "string" ? b.input.query.trim().slice(0, MAX_QUERY) : "";
      if (b.name !== SEARCH_CARDS_TOOL.name || !query) {
        toolCalls.push({ name: b.name, query: query || null, results: 0, error: true });
        return { type: "tool_result", tool_use_id: b.id, is_error: true, content: "Unknown tool or empty query. The only tool is search_cards with a non-empty query." };
      }
      const hits = searchCards(query);
      const fresh = hits.filter((h) => !seen.has(h.card.id));
      for (const h of fresh) { seen.add(h.card.id); extraCards.push({ card: h.card, query }); }
      toolCalls.push({ name: b.name, query, results: hits.length, new_cards: fresh.map((h) => h.card.id) });
      const repeat = hits.filter((h) => !fresh.includes(h));
      const lines = [
        ...fresh.map((h) => cardTag(h.card)),
        ...(repeat.length ? [`Already in retrieved_cards or an earlier search: ${repeat.map((h) => h.card.citation).join("; ")}`] : []),
      ];
      return { type: "tool_result", tool_use_id: b.id, content: lines.length ? lines.join("\n") : "No card in the library matched this search." };
    });
    // All results for one response go back in one user message.
    messages.push({ role: "user", content: results });
  }
}
