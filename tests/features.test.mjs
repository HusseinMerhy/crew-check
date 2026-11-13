// Unit tests for the Nov 13 features: NTE and overtime facts, the Quote Check tick, quote versions
// and follow-up reads, "fixed after the flag", the OBI connection and the reason finder.
// No network, no API credit: node tests/features.test.mjs
import { quoteTotal, nteFact, nteText, overtimeOf, overtimeText, quoteCheckOf, nteOf, liveFacts } from "../lib/quotefacts.js";
import { tracker, followUp, saveFacts } from "../lib/track.js";
import { syncQuotes, hashOf } from "../lib/sync.js";
import { impact, outcomeOf } from "../lib/impact.js";
import { obiRefusal, freshResult, storedResult } from "../lib/obi.js";
import { readReason, reasonUser, REASON_SYSTEM } from "../lib/reason.js";
import { clientPatterns, clientTotals } from "../lib/clients.js";
import { taskFields } from "../lib/clickup.js";
import { GUIDE, NOTES, guideFor } from "../lib/guide.js";
import { crewCheckLine, KEYWORDS } from "../lib/fieldline.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- the quote's total and the NTE ----------
const PHASED = "Tech Reported that the door drags\n\nIncurred:\nTrip $95\n1 hour labor Tech $85\n\nTotal Incurred $180\n\nAdditional:\n3 hours labor Tech 1 $255\n3 hours labor Tech 2 $255\n\nTotal Additional $510\n";
eq("grand total wins", quoteTotal("Trip $95\nTotal Incurred $180\nGrand Total $1,270.24"), 1270.24);
eq("the last grand total", quoteTotal("Grand Total $100\nrevised\nGrand Total $150"), 150);
eq("phases add up without a grand total", quoteTotal(PHASED), 690);
eq("a before-tax line is not the total", quoteTotal("Total Before Taxes $500\nTax 7% $35\nTotal $535"), 535);
eq("the line with tax, after the before-tax line, wins", quoteTotal("Total Incurred before tax $200\nTax $14\nTotal Incurred $214"), 214);
eq("a before-tax total alone is still used", quoteTotal("Total Incurred before tax $200\nTotal Additional $300"), 500);
eq("plain total with a colon and a no-break space", quoteTotal("Labor $90\nTotal: $90"), 90);
eq("labor and material subtotals are not the total", quoteTotal("Total Labor $300\nTotal Materials $50"), null);
eq("no total line", quoteTotal("Tech reported: drain\n2 hours labor Tech 1"), null);
eq("over the NTE", nteFact(PHASED, "500"), { state: "over", pct: 138 });
eq("within the NTE", nteFact(PHASED, 690), { state: "within", pct: 100 });
eq("no NTE on the task", nteFact(PHASED, null), { state: "no nte", pct: null });
eq("no total to compare", nteFact("2 hours labor Tech 1", 500), { state: "no total", pct: null });
eq("NTE words carry no dollar amount", /\$/.test(nteText({ state: "over", pct: 138 })), false);
eq("NTE words say what to do", nteText({ state: "over", pct: 138 }), "Over NTE: the quote is 138% of the NTE. Ask the client for an NTE increase before sending.");

// ---------- overtime ----------
eq("overtime on a labor line, no reason", overtimeOf("Tech reported: door\n3 hours labor Tech 1 OT $[removed]"), { billed: true, reason: false, words: null });
eq("overtime with a reason", overtimeOf("Store requested the work after close\n3 hours labor Tech 1 overtime").reason, false);
eq("store closed is a reason", overtimeOf("Work must be done while the store is closed\n3 hours labor Tech 1 OT"), { billed: true, reason: true, words: "store is closed" });
eq("afterhours as one word counts", overtimeOf("2 hours labor Tech 1 afterhours").billed, true);
eq("OT outside a labor line does not count", overtimeOf("Tech reported the OT sign is broken\nTrip").billed, false);
eq("no overtime, no words", overtimeText(overtimeOf("2 hours labor Tech 1")), null);
eq("overtime words say it is for review", /for review/.test(overtimeText(overtimeOf("2 hours labor Tech 1 OT"))), true);

// ---------- ClickUp fields ----------
const task = (fields, quote = PHASED, status = "quote ready") => ({ id: "k1", name: "WO k1", url: "", status: { status }, list: { id: "901" }, custom_fields: [{ name: "Client Quote", type: "text", value: quote }, ...fields] });
eq("Quote Check ticked", quoteCheckOf(task([{ name: "Quote Check", type: "checkbox", value: "true" }])), true);
eq("Quote Check ticked as a boolean", quoteCheckOf(task([{ name: "Quote Check", type: "checkbox", value: true }])), true);
eq("Quote Check not ticked", quoteCheckOf(task([{ name: "Quote Check", type: "checkbox", value: null }])), false);
eq("Quote Check unticked as text", quoteCheckOf(task([{ name: "Quote Check", type: "checkbox", value: "false" }])), false);
eq("Quote Check not on the list", quoteCheckOf(task([])), null);
eq("the Vista NTE field", nteOf(task([{ name: "16. Client NTE 🔴", type: "currency", value: "450.00" }])), 450);
eq("a plain NTE field", nteOf(task([{ name: "NTE", type: "currency", value: "300" }])), 300);
eq("an empty NTE", nteOf(task([{ name: "16. Client NTE 🔴", type: "currency", value: null }])), null);
const kt = task([{ name: "16. Client NTE 🔴", type: "currency", value: "500" }, { name: "Quote Check", type: "checkbox", value: "true" }]);
const facts = liveFacts(kt, taskFields(kt), hashOf);
eq("fresh facts from a task", [facts.status, facts.quote_check, facts.nte_state, facts.nte_pct, facts.now_t2_hours], ["quote ready", true, "over", 138, 3]);
eq("fresh facts carry no amount", JSON.stringify(facts).includes("690") || JSON.stringify(facts).includes("500"), false);

// ---------- versions and fresh facts, through the sync loop ----------
{
  const q = [];
  const rows = new Map();
  const db = { query: async (text, p) => {
    q.push([text.trim().split(/\s+/).slice(0, 3).join(" "), p]);
    if (text.startsWith("select")) { const r = rows.get(p[0]); return r ? [{ quote_hash: r.hash, job: "x", quote: "x", ok: true, answer: "a", field_written_at: "w" }] : []; }
    if (text.startsWith("insert into auto_checks")) rows.set(p[0], { hash: p[7] });
    return [];
  } };
  const RED = "This quote doesn't show a reason for a second tech.\nOSHA: No | Safety: No | Two-person step: No";
  const good = async () => ({ ok: true, answer: RED });
  const one = (t) => async () => ({ tasks: [t], last: true });
  let out = await syncQuotes({ list: one(kt), sql: db, check: good, history: null, track: tracker(db) });
  const ver = q.find(([s]) => s === "insert into check_versions");
  eq("a good check keeps its version", ver && [ver[1][0], ver[1][2], ver[1][3]], ["k1", "NO REASON: remove Tech 2 or add a two-person step", 3]);
  const upd = q.filter(([s]) => s === "update auto_checks a");
  eq("fresh facts saved once, after the check", [upd.length, upd[0]?.[1][0], upd[0]?.[1][3], upd[0]?.[1][4]], [1, ["k1"], ["over"], [138]]);
  eq("the run reports what it tracked", out.tracked, { facts: 1, problem: null });
  eq("facts are saved after the row exists", q.findIndex(([s]) => s === "update auto_checks a") > q.findIndex(([s]) => s === "insert into auto_checks"), true);
  q.length = 0;
  out = await syncQuotes({ list: one(kt), sql: db, check: good, history: null, track: tracker(db) });
  eq("an unchanged quote: no new version, facts still refreshed", [out.checked, q.some(([s]) => s === "insert into check_versions"), q.filter(([s]) => s === "update auto_checks a").length], [0, false, 1]);
  q.length = 0;
  out = await syncQuotes({ list: one(task([], PHASED + "\nnew line")), sql: db, check: async () => ({ ok: false, problem: "timeout" }), history: null, track: tracker(db) });
  eq("a failed check keeps no version", q.some(([s]) => s === "insert into check_versions"), false);
  // a broken version table never stops the check
  const broken = { query: async (text, p) => { if (/check_versions|update auto_checks a/.test(text)) throw new Error("no table"); return db.query(text, p); } };
  out = await syncQuotes({ list: one(task([], PHASED + "\nother")), sql: broken, check: good, history: null, track: tracker(broken) });
  eq("tracking trouble is reported, the check still counts", [out.checked, out.tracked.problem], [1, "no table"]);
  eq("no tracker: the loop runs as before", Object.keys(await syncQuotes({ list: one(task([], PHASED + "\nthird")), sql: db, check: good, history: null })).includes("tracked"), false);
}

// ---------- follow-up reads of quotes that left the waiting statuses ----------
{
  const calls = [];
  const db = { query: async (text, p) => { calls.push([text.trim().split(/\s+/).slice(0, 3).join(" "), p]); return text.trim().startsWith("select") ? [{ task_id: "a1" }, { task_id: "gone" }] : []; } };
  const getTask = async (id) => { if (id === "gone") throw new Error("ClickUp answered 404"); return { ...kt, id, status: { status: "invoiced" } }; };
  const r = await followUp({ sql: db, getTask, skip: ["k1"] });
  eq("follow-up reads, and notes what ClickUp would not show", r, { read: 1, not_read: 1 });
  eq("skips quotes read in this run, at most the limit", calls[0][1].slice(0, 2), [["k1"], 25]);
  const saved = calls.find(([s]) => s === "update auto_checks a")[1];
  eq("saves the later status and the tick", [saved[0], saved[1], saved[2]], [["a1"], ["invoiced"], [true]]);
  eq("a task not shown is tried again later", calls.find(([s, p]) => s === "update auto_checks set" && p[0][0] === "gone") != null, true);
  eq("nothing to save, no query", await saveFacts({ query: async () => { throw new Error("should not run"); } }, []), 0);
}

// ---------- fixed after the flag ----------
{
  const RED = "This quote doesn't show a reason for a second tech.\nOSHA: No | Safety: No | Two-person step: No";
  const OK2 = "The second tech is justified: this job needs two pairs of hands.\nOSHA: No | Safety: No | Two-person step: Yes";
  const T2 = (h) => `Tech reported: door\n${h} hours labor Tech 1\n${h} hours labor Tech 2`;
  const v = (task_id, quote_hash, line, t2, at) => ({ task_id, quote_hash, line, t2_hours: t2, checked_at: at });
  const R = "NO REASON: remove Tech 2 or add a two-person step", G = "OK TWO-PERSON: Tech 2 OK, a step needs two people", O = "ONE TECH: no Tech 2 on this quote";
  const rows = [
    { task_id: "reason", task_name: "WO 1", ok: true, answer: OK2, quote: T2(4), quote_hash: "h2", checked_at: "2026-11-14", quote_check: true },
    { task_id: "removed", task_name: "WO 2", ok: true, answer: "One person on site.", quote: "Tech reported: door\n4 hours labor Tech 1", quote_hash: "h2", checked_at: "2026-11-14", quote_check: null },
    { task_id: "later", task_name: "WO 3", ok: true, answer: RED, quote: T2(6), quote_hash: "h1", now_hash: "h9", now_t2_hours: 1, checked_at: "2026-11-13", quote_check: false },
    { task_id: "red", task_name: "WO 4", ok: true, answer: RED, quote: T2(5), quote_hash: "h1", checked_at: "2026-11-13", quote_check: true },
    { task_id: "green", task_name: "WO 5", ok: true, answer: OK2, quote: T2(3), quote_hash: "h1", checked_at: "2026-11-13", quote_check: true },
    { task_id: "failed", ok: false, answer: null },
  ];
  const versions = [
    v("reason", "h1", R, 4, "2026-11-13"), v("reason", "h2", G, 4, "2026-11-14"),
    v("removed", "h1", R, 4, "2026-11-13"), v("removed", "h2", O, 0, "2026-11-14"),
  ];
  const out = impact(rows, versions);
  const how = Object.fromEntries([...out.tasks].sort((a, b) => a.task_id.localeCompare(b.task_id)).map((t) => [t.task_id, t.fixed ? t.how : "still red"]));
  eq("each outcome", how, { later: "Tech 2 hours cut", reason: "Reason added", red: "still red", removed: "Tech 2 removed" });
  eq("totals", out.totals, { flagged: 4, fixed: 3, fixed_share: 75, reason_added: 1, t2_removed: 1, t2_cut: 1, hours_cut: 9, still_red: 1 });
  eq("a change seen only in ClickUp is marked", out.tasks.find((t) => t.task_id === "later").unchecked_change, true);
  eq("a quote never red is not flagged", outcomeOf(rows[4], []).flagged, false);
  eq("Quote Check against the verdict", out.quote_check, { known: 4, ticked: 3, red: 1, red_ticked: 1, green: 3, green_ticked: 2, red_ticked_share: 100, green_ticked_share: 67 });
  eq("fixed first, most hours first", out.tasks.map((t) => t.task_id), ["later", "removed", "reason", "red"]);
  // a red quote followed by ASK FIRST is not fixed
  const ask = impact([{ task_id: "q", ok: true, answer: RED, quote: T2(2), quote_hash: "h2", checked_at: "2" }], [v("q", "h1", R, 2, "1"), v("q", "h2", "ASK FIRST: whether there is hot work", 2, "2")]);
  eq("ask first after red is not a fix", ask.totals.fixed, 0);
}

// ---------- the OBI connection ----------
eq("off without a key", obiRefusal("Bearer x", undefined).status, 501);
eq("wrong key", obiRefusal("Bearer nope", "s3cret")?.status ?? "let through", 401);
eq("missing key", obiRefusal(null, "s3cret")?.status ?? "let through", 401);
eq("right key", obiRefusal("Bearer s3cret", "s3cret"), null);
{
  const RED = "This quote doesn't show a reason for a second tech.\nOSHA: No | Safety: No | Two-person step: No";
  const f = freshResult({ answer: RED, quote: PHASED, nte: 500 });
  eq("fresh result: the field line and keyword", [f.keyword, f.line], ["NO REASON", "NO REASON: remove Tech 2 or add a two-person step"]);
  eq("fresh result: NTE as a percent", [f.nte.state, f.nte.pct], ["over", 138]);
  eq("fresh result carries no dollar amount", /\$\s?\d/.test(JSON.stringify(f)), false);
  eq("no NTE sent: no NTE in the result", freshResult({ answer: RED, quote: PHASED }).nte, null);
  const s = storedResult({ task_id: "k1", ok: true, answer: RED, quote: "3 hours labor Tech 2", quote_hash: "a", now_hash: "b", nte_state: "within", nte_pct: 80, quote_check: false });
  eq("stored result: changed since the check", [s.keyword, s.current, s.nte.pct, s.quote_check], ["NO REASON", false, 80, false]);
  eq("stored result: not checked yet", storedResult(undefined).ok, false);
  eq("stored result: last check failed", storedResult({ task_id: "k1", ok: false, problem: "timeout" }).problem.startsWith("The last check failed: timeout"), true);
}

// ---------- the reason finder ----------
{
  const CONV = "Dispatcher: why two techs?\nTech: The door is about 300 lb, I need someone to hold it while I set the hinges.\nDispatcher: ok";
  const said = (o) => JSON.stringify(o);
  const r = readReason(`Here you go: ${said({ found: true, words: "The door is about 300 lb, I need someone to hold it while I set the hinges", step: "Two techs to hold the 300 lb door while the hinges are set." })}`, CONV);
  eq("found, with the tech's words", [r.found, r.step], [true, "Two techs to hold the 300 lb door while the hinges are set."]);
  eq("spacing and case may differ", readReason(said({ found: true, words: "the door is about 300 LB,  I need someone", step: "x" }), CONV).found, true);
  eq("words not in the conversation are refused", readReason(said({ found: true, words: "the door weighs 400 lb and needs two people", step: "Two techs." }), CONV), { found: false, words: "", step: "", note: "The words given are not in the conversation, so nothing is suggested. Read the conversation yourself." });
  eq("a few words are not enough", readReason(said({ found: true, words: "door", step: "Two techs." }), CONV).found, false);
  eq("nothing found", readReason(said({ found: false, words: "", step: "" }), CONV).found, false);
  eq("unreadable answer", readReason("I think so", CONV).note, "The answer could not be read. Try again.");
  eq("no amount or em dash in the step", readReason(said({ found: true, words: "I need someone to hold it", step: "Hold the door \u2014 $200 of labor" }), CONV).step, "Hold the door, $[removed] of labor");
  eq("the quote goes to the model without amounts", /\$\d/.test(reasonUser("Total $500", CONV)), false);
  eq("the instructions hold no em dash", REASON_SYSTEM.includes("\u2014"), false);
}

// ---------- NTE and overtime per client ----------
{
  const RED = "This quote doesn't show a reason for a second tech.\nOSHA: No | Safety: No | Two-person step: No";
  const row = (id, fm, quote, nte_state = null, nte_pct = null) => ({ task_id: id, task_name: `WO ${id}`, fm, answer: RED, quote, ok: true, nte_state, nte_pct, checked_at: "2026-11-13" });
  const list = clientPatterns([
    row("a", "EMCOR", "3 hours labor Tech 1 OT\n3 hours labor Tech 2 OT", "over", 130),
    row("b", "EMCOR", "Store closed at night\n2 hours labor Tech 1 OT", "within", 90),
    row("c", "EMCOR", "2 hours labor Tech 1"),
  ], null);
  const e = list[0];
  eq("per client: over NTE and overtime without a reason", [e.over_nte, e.ot, e.ot_no_reason], [1, 2, 1]);
  eq("per client: the work orders to look at, no amounts", e.others, [{ task_id: "a", task_name: "WO a", task_url: null, nte_pct: 130, ot: true }]);
  eq("totals add them up", [clientTotals(list).over_nte, clientTotals(list).ot_no_reason], [1, 1]);
}

// ---------- the field guide: every line the field can show has words for the dispatcher ----------
{
  eq("one guide entry per field keyword", GUIDE.map((g) => g.key).sort(), [...KEYWORDS].sort());
  const sum = (o, sf, t) => `OSHA: ${o} | Safety: ${sf} | Two-person step: ${t}`;
  const T2Q = "Tech reported: mirror\n4 hours labor Tech 1\n4 hours labor Tech 2";
  const answers = {
    "NO REASON": `This quote doesn't show a reason for a second tech.\n${sum("No", "No", "No")}`,
    "ASK FIRST": `OSHA may require a second tech here, if there is hot work.\n${sum("Need whether there is hot work", "No", "No")}`,
    "OSHA": `OSHA requires a second tech here.\n${sum("Yes", "No", "No")}`,
    "OK SAFETY": `A second tech makes sense here for safety.\n${sum("No", "Yes, 120 lb stated", "No")}`,
    "OK TWO-PERSON": `The second tech is justified: this job needs two pairs of hands.\n${sum("No", "No", "Yes")}`,
  };
  const got = Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, guideFor(crewCheckLine(a, T2Q))?.key]));
  eq("every line the check writes finds its guide entry", got, { "NO REASON": "NO REASON", "ASK FIRST": "ASK FIRST", "OSHA": "OSHA", "OK SAFETY": "OK SAFETY", "OK TWO-PERSON": "OK TWO-PERSON" });
  eq("a one-tech quote finds its entry", guideFor(crewCheckLine(answers["NO REASON"], "Tech reported: mirror\n2 hours labor Tech 1"))?.decision, "Nothing to do");
  eq("a phased line finds its entry", guideFor("NO REASON (Additional): remove Tech 2 or add a two-person step")?.decision, "Rejected");
  eq("the live test's line", guideFor("OK SAFETY: Tech 2 OK for safety")?.decision, "Approved");
  eq("no line, no entry", [guideFor(null), guideFor("SOMETHING: else")], [null, null]);
  eq("decisions are the four agreed words", [...new Set(GUIDE.map((g) => g.decision))].sort(), ["Approved", "Nothing to do", "On hold", "Rejected"]);
  const words = JSON.stringify([GUIDE, NOTES]);
  eq("guide words: no em dash, no dollar amount", [words.includes("\u2014"), /\$\s?\d/.test(words)], [false, false]);
  eq("every entry says what to tell the dispatcher", [...GUIDE, ...NOTES].every((g) => g.means && g.tell && g.tell.length < 400), true);
}

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
