// Unit tests for lib/agentic.js with a fake model and a fake card search.
// No network and no API key: this checks the loop's caps, fallbacks and message shapes, not the
// quality of any answer. Answer quality is the eval's job (node evals/run_eval.js --agentic).
// Run: node tests/agentic.test.mjs
import assert from "node:assert/strict";
import { runAgentic, MAX_TOOL_CALLS, SEARCH_CARDS_TOOL, cardTag, addUsage } from "../lib/agentic.js";

const CARD_A = { id: "a", citation: "29 CFR 1910.146", layer: "OSHA", state: "FED", title: "Attendant", text: "A second person must stay outside." };
const CARD_B = { id: "b", citation: "29 CFR 1910.252(b)(4)(iv)", layer: "OSHA", state: "FED", title: "Welding attendant", text: "An attendant must be stationed outside." };
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 1 };
const ANSWER = "The quote doesn't show a reason for a second tech.\nOSHA: No | Safety: No | Two-person step: No";

const answer = (text = ANSWER) => ({ ok: true, data: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "sig-final" }, { type: "text", text }], usage: USAGE } });
const tool = (...uses) => ({ ok: true, data: { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "sig-tool" }, ...uses.map(([id, input, name = "search_cards"]) => ({ type: "tool_use", id, name, input }))], usage: USAGE } });

// A model that plays back a script and keeps a snapshot of every request it was sent.
function model(script) {
  let i = 0;
  const fn = async (opts) => { fn.seen.push(structuredClone(opts)); return script[i++] ?? answer(); };
  fn.seen = [];
  return fn;
}
function search() {
  const fn = (q) => { fn.queries.push(q); return /tank/.test(q) ? [{ card: CARD_A, hits: ["tank"] }, { card: CARD_B, hits: ["tank"] }] : []; };
  fn.queries = [];
  return fn;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("answers without searching: one call, tools offered with tool_choice auto", async () => {
  const m = model([answer()]);
  const r = await runAgentic({ callModel: m, searchCards: search(), user: "quote" });
  assert.equal(r.ok, true);
  assert.equal(r.answer, ANSWER);
  assert.equal(r.calls, 1);
  assert.deepEqual(r.toolCalls, []);
  assert.equal(m.seen[0].toolChoice.type, "auto");
  assert.equal(m.seen[0].tools[0].name, "search_cards");
  assert.deepEqual(m.seen[0].messages, [{ role: "user", content: "quote" }]);
});

test("search then answer: full assistant content goes back unchanged, tool_result matches the id", async () => {
  const s = search();
  const m = model([tool(["t1", { query: "weld inside the tank" }]), answer()]);
  const r = await runAgentic({ callModel: m, searchCards: s, user: "quote", seenIds: ["a"] });
  assert.equal(r.ok, true);
  assert.equal(r.calls, 2);
  assert.deepEqual(s.queries, ["weld inside the tank"]);
  const [, assistant, results] = m.seen[1].messages;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content[0].signature, "sig-tool"); // thinking block passed back as received
  assert.equal(results.role, "user");
  assert.equal(results.content[0].type, "tool_result");
  assert.equal(results.content[0].tool_use_id, "t1");
  assert.ok(results.content[0].content.includes(cardTag(CARD_B)), "new card returned in full");
  assert.ok(!results.content[0].content.includes(cardTag(CARD_A)), "card already in the prompt not repeated");
  assert.ok(results.content[0].content.includes("Already in retrieved_cards or an earlier search: 29 CFR 1910.146"));
  assert.deepEqual(r.extraCards.map((x) => x.card.id), ["b"]);
  assert.deepEqual(r.toolCalls, [{ name: "search_cards", query: "weld inside the tank", results: 2, new_cards: ["b"] }]);
});

test("usage is summed across every call", async () => {
  const r = await runAgentic({ callModel: model([tool(["t1", { query: "tank" }]), tool(["t2", { query: "roof" }]), answer()]), searchCards: search(), user: "q" });
  assert.deepEqual(r.usage, { input_tokens: 30, output_tokens: 15, cache_read_input_tokens: 300, cache_creation_input_tokens: 3 });
});

test(`stops searching at ${MAX_TOOL_CALLS}: the next call has tool_choice none`, async () => {
  const script = Array.from({ length: MAX_TOOL_CALLS }, (_, i) => tool([`t${i}`, { query: `tank ${i}` }]));
  const m = model([...script, answer()]);
  const r = await runAgentic({ callModel: m, searchCards: search(), user: "q" });
  assert.equal(r.ok, true);
  assert.equal(r.calls, MAX_TOOL_CALLS + 1);
  assert.equal(r.toolCalls.length, MAX_TOOL_CALLS);
  assert.deepEqual(m.seen.map((o) => o.toolChoice.type), [...Array(MAX_TOOL_CALLS).fill("auto"), "none"]);
});

test("a tool call after the limit fails instead of looping", async () => {
  const script = Array.from({ length: MAX_TOOL_CALLS + 3 }, (_, i) => tool([`t${i}`, { query: "tank" }]));
  const r = await runAgentic({ callModel: model(script), searchCards: search(), user: "q" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "tool call after the search limit");
  assert.equal(r.calls, MAX_TOOL_CALLS + 1);
});

test("parallel tool calls: one user message with every result, over-the-limit ones refused", async () => {
  const m = model([tool(["t1", { query: "tank" }], ["t2", { query: "roof" }], ["t3", { query: "ladder" }]), answer()]);
  const r = await runAgentic({ callModel: m, searchCards: search(), user: "q", maxToolCalls: 2 });
  assert.equal(r.ok, true);
  const results = m.seen[1].messages[2].content;
  assert.deepEqual(results.map((x) => x.tool_use_id), ["t1", "t2", "t3"]);
  assert.equal(results[1].content, "No card in the library matched this search.");
  assert.equal(results[2].is_error, true);
  assert.equal(r.toolCalls.length, 2);
});

test("a failed model call falls back with the reason", async () => {
  const r = await runAgentic({ callModel: model([{ ok: false, problem: "timeout" }]), searchCards: search(), user: "q" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "model call failed: timeout");
  assert.equal(r.calls, 1);
});

test("refusal and max_tokens fall back, and that turn's tools never run", async () => {
  for (const stop of ["refusal", "max_tokens"]) {
    const s = search();
    const msg = tool(["t1", { query: "tank" }]);
    msg.data.stop_reason = stop;
    const r = await runAgentic({ callModel: model([msg]), searchCards: s, user: "q" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, `stop_reason ${stop}`);
    assert.deepEqual(s.queries, []);
  }
});

test("empty query or unknown tool gets an error result, not a search", async () => {
  const s = search();
  const m = model([tool(["t1", {}], ["t2", { query: "tank" }, "delete_everything"]), answer()]);
  const r = await runAgentic({ callModel: m, searchCards: s, user: "q" });
  assert.equal(r.ok, true);
  assert.deepEqual(s.queries, []);
  const results = m.seen[1].messages[2].content;
  assert.ok(results.every((x) => x.is_error === true));
  assert.deepEqual(r.toolCalls.map((x) => x.error), [true, true]);
});

test("a long query is cut to 200 characters before searching", async () => {
  const s = search();
  await runAgentic({ callModel: model([tool(["t1", { query: "tank ".repeat(100) }]), answer()]), searchCards: s, user: "q" });
  assert.equal(s.queries[0].length, 200);
});

test("an empty final answer falls back", async () => {
  const r = await runAgentic({ callModel: model([answer("")]), searchCards: search(), user: "q" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty answer");
});

test("time budget: each call gets the time left, and an exhausted budget falls back", async () => {
  let t = 0;
  const m = model([tool(["t1", { query: "tank" }]), tool(["t2", { query: "tank" }]), answer()]);
  const timed = async (opts) => { const out = await m(opts); t += 600; return out; };
  const r = await runAgentic({ callModel: timed, searchCards: search(), user: "q", budgetMs: 1000, now: () => t });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "time budget used up");
  assert.deepEqual(m.seen.map((o) => o.timeoutMs), [1000, 400]);
});

test("cardTag matches the <card> line the fixed pipeline has always sent", () => {
  const f = { card: CARD_A };
  const before = `<card citation="${f.card.citation}" layer="${f.card.layer}" state="${f.card.state}">${f.card.title}: ${f.card.text}</card>`;
  assert.equal(cardTag(CARD_A), before);
});

test("the tool schema meets strict tool use: required plus additionalProperties false", () => {
  assert.equal(SEARCH_CARDS_TOOL.strict, true);
  assert.equal(SEARCH_CARDS_TOOL.input_schema.additionalProperties, false);
  assert.deepEqual(SEARCH_CARDS_TOOL.input_schema.required, ["query"]);
});

test("addUsage treats missing usage as zero", () => {
  assert.deepEqual(addUsage(null, undefined), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
