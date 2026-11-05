// Unit tests for the Vol 2 pieces that run without a network: the job type, the history lookup
// and the read-only ClickUp import's parsing. No API credit: node tests/vol2.test.mjs
import { jobOf, lookup, lookupJob, historyLine, clientsOf, MIN_QUOTES } from "../lib/history.js";
import { parseTaskRef, fieldText } from "../lib/clickup.js";
import { taskIdOf, isWaiting, waitingStatuses, readBody, shapeOf, problemOf, outcomeOf, logCall, finishCall } from "../lib/webhook.js";
import { syncQuotes, fillQuotes, MAX_PER_RUN } from "../lib/sync.js";
import { parseAnswer, secondTechHours, toneOf } from "../lib/answer.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// job type: scope only, money and parts lines ignored
eq("door", jobOf("Tech reported: rear door closer leaking\nRequired is to: replace closer"), "Door repair or replacement");
eq("water heater beats leak", jobOf("Water heater leaking from the tank seam"), "Water heater");
eq("parts list ignored", jobOf("Tech reported: snake the floor drain\n\nParts: door stop, light bulb"), "Snake / clog / drain");
eq("other", jobOf("Tech reported: something unusual"), "Other");

// lookup
const H = {
  everyone: { all: { n: 100 }, jobs: { "Door repair or replacement": { n: 50, t2: 70 } } },
  entities: {
    BKR: { all: { n: 60 }, jobs: { "Door repair or replacement": { n: 30, t2: 80 }, "Roof": { n: MIN_QUOTES - 1, t2: 50 } } },
  },
};
const door = "Tech reported: door hinge broken";
eq("entity row", lookup(H, "BKR", door).entity, { n: 30, t2: 80 });
eq("everyone row", lookup(H, "BKR", door).everyone, { n: 50, t2: 70 });
eq("too few quotes hidden", lookup(H, "BKR", "Tech reported: roof leak over aisle 3").entity, null);
eq("unknown entity", lookup(H, "SFM", door).hasEntity, false);
eq("no history", lookup(null, "BKR", door).entity, null);

// ClickUp task references
eq("task url", parseTaskRef("https://app.clickup.com/t/86a2tqk0c"), { id: "86a2tqk0c", custom: false });
eq("url with team", parseTaskRef("https://app.clickup.com/t/9005131470/WO-2338"), { id: "WO-2338", custom: true });
eq("bare WO", parseTaskRef(" wo-2338 "), { id: "WO-2338", custom: true });
eq("bare id", parseTaskRef("86a2tqk0c"), { id: "86a2tqk0c", custom: false });
eq("work order name is not an id", parseTaskRef("240326-0534"), null);
eq("junk", parseTaskRef("drop table"), null);

// custom fields as the ClickUp v2 task endpoint returns them
const task = { custom_fields: [
  { name: "Client Quote", type: "text", value: "Tech reported that: leak" },
  { name: "State", type: "drop_down", value: 34, type_config: { options: [{ id: "a", name: "OH", orderindex: 34 }, { id: "b", name: "TX", orderindex: 44 }] } },
  { name: "21. Comp", type: "drop_down", value: "c-id", type_config: { options: [{ id: "c-id", name: "BKR", orderindex: 5 }] } },
  { name: "Trade", type: "drop_down" },
] };
eq("text field", fieldText(task, "Client Quote"), "Tech reported that: leak");
eq("dropdown by orderindex", fieldText(task, "State"), "OH");
eq("dropdown by option id", fieldText(task, "21. Comp"), "BKR");
eq("unset field", fieldText(task, "Trade"), "");
eq("missing field", fieldText(task, "Store"), "");
eq("plain field names read too", (await import("../lib/clickup.js")).taskFields({ id: "t", name: "n", status: { status: "quote ready" }, custom_fields: [
  { name: "Comp", type: "short_text", value: "SFM" }, { name: "FM", type: "short_text", value: "Flynn" }, { name: "State", type: "short_text", value: "FL" },
  { name: "Client Quote", type: "text", value: "Tech Reported: mirror" }] }).entity + "/" + "Flynn", "SFM/Flynn");

// the daily sync loop, with ClickUp, the database and the check faked
const quoteTask = (id, text, state = 34) => ({ id, name: `WO ${id}`, url: "", status: { status: "quote ready" }, custom_fields: [
  { name: "Client Quote", type: "text", value: text },
  { name: "State", type: "drop_down", value: state, type_config: { options: [{ id: "a", name: "OH", orderindex: 34 }, { id: "b", name: "TX", orderindex: 44 }] } },
  { name: "21. Comp", type: "drop_down", value: 5, type_config: { options: [{ id: "c", name: "BKR", orderindex: 5 }] } },
] });
function fakeDb() {
  const rows = new Map();
  return { rows, query: async (q, p) => {
    if (q.startsWith("select")) return rows.has(p[0]) ? [{ quote_hash: rows.get(p[0])[7], job: rows.get(p[0])[13] ?? null, quote: rows.get(p[0])[14] ?? null }] : [];
    if (q.startsWith("update")) { rows.get(p[0])[13] = p[1]; rows.get(p[0])[14] = p[2]; return []; }
    rows.set(p[0], p); return [];
  } };
}
const hinge = "Tech reported: rear door hinge broken, door drags on the floor";
let checks = 0;
const okCheck = async () => { checks++; return { ok: true, answer: "The second tech is justified: this job needs two pairs of hands.\nOSHA: No | Safety: No | Two-person step: Yes" }; };
const pages = [[quoteTask("t1", hinge), quoteTask("t2", "too short"), quoteTask("t3", hinge + " again", 44)]];
const list = async (page) => ({ tasks: pages[page] || [], last: page >= pages.length - 1 });
const db = fakeDb();
let out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("first run checks the two real quotes", [out.checked, out.no_quote, out.unchanged], [2, 1, 0]);
eq("stores the headline", db.rows.get("t1")[8], "The second tech is justified: this job needs two pairs of hands.");
eq("stores the state from ClickUp", db.rows.get("t3")[6], "TX");
eq("stores the entity history line", db.rows.get("t1")[10], "BKR: a second tech on 80% of 30 past door repair or replacement quotes (all quotes: 70%).");
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("second run skips unchanged quotes", [out.checked, out.unchanged, checks], [0, 2, 2]);
pages[0][0] = quoteTask("t1", hinge + ", now with a new step");
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("a changed quote is checked again", [out.checked, out.unchanged], [1, 1]);
eq("stores the job type", db.rows.get("t3")[13], "Door repair or replacement");
eq("stores the quote", db.rows.get("t1")[14], hinge + ", now with a new step");
// a row saved before the job type was stored gets it on the next run, without a new check
db.rows.get("t3")[13] = undefined; db.rows.get("t3")[14] = undefined;
const before = checks;
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("backfills the job type and quote without a new check", [db.rows.get("t3")[13], db.rows.get("t3")[14], checks - before], ["Door repair or replacement", hinge + " again", 0]);
eq("history line from entity and job", historyLine(H, "BKR", "Door repair or replacement"), "BKR: a second tech on 80% of 30 past door repair or replacement quotes (all quotes: 70%).");
eq("no history line for an entity without numbers", historyLine(H, "SFM", "Door repair or replacement"), null);
const money = fakeDb();
await syncQuotes({ list: async () => ({ tasks: [quoteTask("p1", hinge + ". Total: $1,270.24")], last: true }), sql: money, check: okCheck, history: null });
eq("dollar amounts are removed from the stored quote", money.rows.get("p1")[14], hinge + ". Total: $[removed]");
// queue rows saved before quotes were stored are filled straight from ClickUp, with no new check
const oldRows = [{ task_id: "o1", quote: null, job: null }, { task_id: "o2", quote: null, job: null }, { task_id: "o3", quote: "kept", job: "Other" }];
const updates = [];
const fetched = [];
const n = await fillQuotes({ rows: oldRows, sql: { query: async (q, p) => { updates.push(p); return []; } },
  getTask: async (id) => { fetched.push(id); if (id === "o2") return quoteTask(id, ""); return quoteTask(id, hinge + " $99"); } });
eq("fills only rows without a quote", [n, fetched], [2, ["o1", "o2"]]);
eq("filled quote has money removed and a job type", [oldRows[0].quote, oldRows[0].job], [hinge + " $[removed]", "Door repair or replacement"]);
eq("a task with no quote is marked empty, not refetched", oldRows[1].quote, "");
const failing = async () => ({ ok: false, problem: "timeout" });
const db2 = fakeDb();
out = await syncQuotes({ list, sql: db2, check: failing, history: null });
eq("a failed check is stored without a hash, so the next run retries it", [out.failed, db2.rows.get("t1")[7], db2.rows.get("t1")[12]], [2, null, "timeout"]);
const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => quoteTask(`m${i}`, hinge + ` #${i}`));
out = await syncQuotes({ list: async () => ({ tasks: many, last: true }), sql: fakeDb(), check: okCheck, history: null });
eq("caps a run and says more are waiting", [out.checked, out.left_for_next_run], [MAX_PER_RUN, true]);

// second tech hours, in the forms real ClickUp quotes use
eq("Tech 2 - 4 hrs", secondTechHours("Labor: Tech 1 - 4 hrs; Tech 2 - 4 hrs"), 4);
eq("8 hours labor Tech 2", secondTechHours("-8 hours labor Tech 1 $[removed]\n-8 hours labor Tech 2 $[removed]"), 8);
eq("7 hours labor helper", secondTechHours("-7 hours labor tech:$455\n-7 hours labor helper: $182"), 7);
eq("Tech 1 only", secondTechHours("Labor hour:\n-3 hours labor Tech 1 $[removed]"), null);
eq("no reason on a Tech 1 only quote is not a problem", toneOf("This quote doesn't show a reason for a second tech.", "-3 hours labor Tech 1").tone, "wait");
eq("no reason with a Tech 2 billed needs a person", toneOf("This quote doesn't show a reason for a second tech.", "-3 hours labor Tech 2").tone, "tape");
eq("no quote given keeps the tape", toneOf("This quote doesn't show a reason for a second tech.").tone, "tape");
// a phased answer opens with the phase name
const phased = parseAnswer("Incurred:\nThe second tech is justified: this job needs two pairs of hands.\nStep 2 needs two people.\nOSHA: No | Safety: No | Two-person step: Yes");
eq("phase label skipped to find the headline", phased.headline, "The second tech is justified: this job needs two pairs of hands.");
eq("phase label on the same line", parseAnswer("Incurred: OSHA may require a second tech here, if X.\nOSHA: Need X | Safety: No | Two-person step: No").headline, "OSHA may require a second tech here, if X.");

// per client, and per entity with that client, in the packed [n, t2, t3, reason, t2h] rows
const P = {
  everyone: { all: [100, 50, 5, 50, 3], jobs: { "Door repair or replacement": [50, 70, 2, 80, 3] } },
  entities: { BKR: { all: [60, 60, 5, 50, 3], jobs: { "Door repair or replacement": [30, 80, 2, 88, 3] } } },
  clients: { EMCOR: { all: [40, 75, 1, 90, 3], jobs: { "Door repair or replacement": [25, 76, 0, 90, 3] } } },
  pairs: { "BKR|EMCOR": { all: [35, 78, 1, 90, 3], jobs: { "Door repair or replacement": [22, 82, 0, 91, 3] } } },
};
const L = lookupJob(P, "BKR", "Door repair or replacement", "emcor");
eq("client matched without case", L.client, "EMCOR");
eq("packed rows read", [L.entity.t2, L.clientRow.t2, L.pair.t2, L.everyone.t2], [80, 76, 82, 70]);
eq("line prefers entity with client", historyLine(P, "BKR", "Door repair or replacement", "EMCOR"), "BKR with EMCOR: a second tech on 82% of 22 past door repair or replacement quotes (all quotes: 70%).");
eq("line falls back to the client", historyLine(P, "SFM", "Door repair or replacement", "EMCOR"), "EMCOR: a second tech on 76% of 25 past door repair or replacement quotes (all quotes: 70%).");
eq("unknown client falls back to the entity", historyLine(P, "BKR", "Door repair or replacement", "Nobody"), "BKR: a second tech on 80% of 30 past door repair or replacement quotes (all quotes: 70%).");
eq("client list", clientsOf(P), ["EMCOR"]);

// the ClickUp webhook: where the task id is, and which statuses count as waiting
eq("automation payload", taskIdOf({ auto_id: "x", payload: { id: "86a2tqk0c", name: "WO" } }), "86a2tqk0c");
eq("API webhook", taskIdOf({ event: "taskStatusUpdated", task_id: "86akpqfkk" }), "86akpqfkk");
eq("hand-made test call", taskIdOf({ id: "86a2b8cu8" }), "86a2b8cu8");
eq("no id", taskIdOf({ hello: 1 }), null);
eq("junk id refused", taskIdOf({ id: "../../etc" }), null);
eq("default statuses", waitingStatuses({}), ["quote ready", "!! waiting for approval"]);
eq("statuses from settings", waitingStatuses({ CLICKUP_SYNC_STATUSES: "quote ready, waiting for quote" }), ["quote ready", "waiting for quote"]);
eq("waiting, any case", isWaiting({ status: { status: "Quote Ready" } }, waitingStatuses({})), true);
eq("not waiting", isWaiting({ status: { status: "invoiced" } }, waitingStatuses({})), false);
eq("the !! flag is ignored", isWaiting({ status: { status: "waiting for approval" } }, waitingStatuses({})), true);
eq("a misspelt status is not guessed", isWaiting({ status: { status: "quote read" } }, waitingStatuses({})), false);

// the webhook log: what a call carried, read in every shape a sender may use
eq("JSON body", readBody('{"payload":{"id":"17tvd0tb7ba"}}'), { payload: { id: "17tvd0tb7ba" } });
eq("form body", readBody("task_id=17tvd0tb7ba&x=1"), { task_id: "17tvd0tb7ba", x: "1" });
eq("form field holding JSON", taskIdOf(readBody(`payload=${encodeURIComponent('{"id":"17tvd0tb7ba"}')}`)), "17tvd0tb7ba");
eq("empty body", readBody(""), null);
eq("payload sent as a JSON string", taskIdOf({ payload: '{"id":"17tvd0tb7ba"}' }), "17tvd0tb7ba");
eq("task nested in payload", taskIdOf({ payload: { task: { id: "17tvd0tb7ba" } } }), "17tvd0tb7ba");
eq("task under data", taskIdOf({ data: { id: "17tvd0tb7ba" } }), "17tvd0tb7ba");
eq("a junk id does not hide a good one", taskIdOf({ task_id: "../x", payload: { id: "17tvd0tb7ba" } }), "17tvd0tb7ba");
eq("shape is names only", shapeOf({ auto_id: "secret-ish", payload: { id: "a", name: "Customer Inc" } }), "auto_id, payload {id, name}");
eq("shape of nothing", shapeOf(null), "empty or unreadable body");
eq("hidden task explained", /cannot see it/.test(problemOf(new Error("ClickUp answered 401"))), true);
eq("other errors kept", problemOf(new Error("timeout")), "timeout");
eq("outcome checked", outcomeOf({ checked: 1 }), "Checked");
eq("outcome unchanged", outcomeOf({ checked: 0, failed: 0, unchanged: 1 }), "Already checked, same quote");
eq("outcome no quote", outcomeOf({ checked: 0, failed: 0, unchanged: 0, no_quote: 1 }), "No Client Quote on the task");
{
  const calls = [];
  const fake = { query: async (q, p) => { calls.push([q.trim().split(/\s+/).slice(0, 3).join(" "), p]); return /returning id/.test(q) ? [{ id: 7 }] : []; } };
  const id = await logCall(fake, { task_id: "17tvd0tb7ba", outcome: "Received, checking" });
  await finishCall(fake, id, { task_name: "WO", outcome: "Checked" });
  eq("log row id", id, 7);
  eq("log writes then trims", calls.map((c) => c[0]), ["create table if", "insert into webhook_log", "delete from webhook_log", "update webhook_log set"]);
  eq("finish updates that row", calls[3][1], [7, "WO", "Checked", null]);
}

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
