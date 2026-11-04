// Unit tests for the Vol 2 pieces that run without a network: the job type, the history lookup
// and the read-only ClickUp import's parsing. No API credit: node tests/vol2.test.mjs
import { jobOf, lookup, historyLine, MIN_QUOTES } from "../lib/history.js";
import { parseTaskRef, fieldText } from "../lib/clickup.js";
import { syncQuotes, MAX_PER_RUN } from "../lib/sync.js";

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

// the daily sync loop, with ClickUp, the database and the check faked
const quoteTask = (id, text, state = 34) => ({ id, name: `WO ${id}`, url: "", status: { status: "quote ready" }, custom_fields: [
  { name: "Client Quote", type: "text", value: text },
  { name: "State", type: "drop_down", value: state, type_config: { options: [{ id: "a", name: "OH", orderindex: 34 }, { id: "b", name: "TX", orderindex: 44 }] } },
  { name: "21. Comp", type: "drop_down", value: 5, type_config: { options: [{ id: "c", name: "BKR", orderindex: 5 }] } },
] });
function fakeDb() {
  const rows = new Map();
  return { rows, query: async (q, p) => {
    if (q.startsWith("select")) return rows.has(p[0]) ? [{ quote_hash: rows.get(p[0])[7], job: rows.get(p[0])[13] ?? null }] : [];
    if (q.startsWith("update")) { rows.get(p[0])[13] = p[1]; return []; }
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
eq("stores the entity history line", db.rows.get("t1")[10], "BKR quoted a second tech on 80% of 30 past door repair or replacement quotes (all entities: 70%).");
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("second run skips unchanged quotes", [out.checked, out.unchanged, checks], [0, 2, 2]);
pages[0][0] = quoteTask("t1", hinge + ", now with a new step");
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("a changed quote is checked again", [out.checked, out.unchanged], [1, 1]);
eq("stores the job type", db.rows.get("t3")[13], "Door repair or replacement");
// a row saved before the job type was stored gets it on the next run, without a new check
db.rows.get("t3")[13] = undefined;
const before = checks;
out = await syncQuotes({ list, sql: db, check: okCheck, history: H });
eq("backfills the job type without a new check", [db.rows.get("t3")[13], checks - before], ["Door repair or replacement", 0]);
eq("history line from entity and job", historyLine(H, "BKR", "Door repair or replacement"), "BKR quoted a second tech on 80% of 30 past door repair or replacement quotes (all entities: 70%).");
eq("no history line for an entity without numbers", historyLine(H, "SFM", "Door repair or replacement"), null);
const failing = async () => ({ ok: false, problem: "timeout" });
const db2 = fakeDb();
out = await syncQuotes({ list, sql: db2, check: failing, history: null });
eq("a failed check is stored without a hash, so the next run retries it", [out.failed, db2.rows.get("t1")[7], db2.rows.get("t1")[12]], [2, null, "timeout"]);
const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => quoteTask(`m${i}`, hinge + ` #${i}`));
out = await syncQuotes({ list: async () => ({ tasks: many, last: true }), sql: fakeDb(), check: okCheck, history: null });
eq("caps a run and says more are waiting", [out.checked, out.left_for_next_run], [MAX_PER_RUN, true]);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
