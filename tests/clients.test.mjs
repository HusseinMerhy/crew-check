// Unit tests for the Clients page's patterns (lib/clients.js). No network, no credit:
//   node tests/clients.test.mjs
import { clientPatterns, clientTotals, verdictOf } from "../lib/clients.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const sum = (o, s, t) => `OSHA: ${o} | Safety: ${s} | Two-person step: ${t}`;
const RED = `This quote doesn't show a reason for a second tech.\n${sum("No", "No", "No")}`;
const OK2 = `The second tech is justified: this job needs two pairs of hands.\n${sum("No", "No", "Yes")}`;
const ASK = `OSHA may require a second tech here, if there is hot work.\n${sum("Need whether there is hot work", "No", "No")}`;
const T2 = (h) => `Tech reported: drain\n${h} hours labor Tech 1 $10\n${h} hours labor Tech 2 $10`;
const T1 = "Tech reported: drain\n2 hours labor Tech 1";
const row = (id, fm, answer, quote, job = "Snake / clog / drain", entity = "BKR") => ({ task_id: id, task_name: `WO ${id}`, fm, entity, job, answer, quote, ok: true, checked_at: "2026-11-13T10:00:00Z" });

const H = { clients: { EMCOR: { all: [1000, 52, 5, 40, 3] }, Quiet: { all: [58, 0, 0, null, null] } } };
const rows = [
  row("a", "EMCOR", RED, T2(8)), row("b", "EMCOR", RED, T2(4), "Door repair or replacement"), row("c", "EMCOR", OK2, T2(3), "Door repair or replacement"),
  row("d", "EMCOR", RED, T1), row("e", "EMCOR", ASK, T2(2), "HVAC / refrigeration"),
  row("f", "Quiet", RED, T2(5), "Toilet / urinal"), row("g", "Quiet", OK2, T2(5)), row("h", "Quiet", RED, T2(1)), row("i", "Quiet", RED, T1),
  { ...row("x", "EMCOR", RED, T2(9)), ok: false },
];
const list = clientPatterns(rows, H);
const emcor = list.find((c) => c.client === "EMCOR");

eq("verdict keyword without the phase", verdictOf("NO REASON (Additional): remove Tech 2"), "NO REASON");
eq("counts per verdict; a Tech 1 only quote is not red", [emcor.checked, emcor.red, emcor.ask, emcor.green, emcor.one], [5, 2, 1, 1, 1]);
eq("share is of quotes with a Tech 2", [emcor.with_t2, emcor.red_share], [4, 50]);
eq("hours without a reason add up the Tech 2 hours", emcor.hours_no_reason, 12);
eq("failed checks are left out", list.reduce((n, c) => n + c.checked, 0), 9);
eq("most hours first", list.map((c) => c.client), ["EMCOR", "Quiet"]);
eq("jobs without a reason, most first", emcor.jobs.map((j) => j.job), ["Snake / clog / drain", "Door repair or replacement"]);
eq("quotes to fix, most hours first", emcor.reds.map((r) => r.task_id), ["a", "b"]);
eq("history from the client's past quotes", emcor.history, { n: 1000, t2: 52, reason: 40, t2h: 3 });
eq("advice: what to write, one-person work, past reasons", emcor.advice, [
  "2 of 4 Tech 2 quotes don't say why two people are needed: write the two-person step or quote one tech.",
  "Snake / clog / drain is usually one-person work: review the Tech 2 on that quote.",
  "In past quotes only 40% of this client's Tech 2 quotes had a reason written (1,000 quotes).",
]);
const quiet = list.find((c) => c.client === "Quiet");
eq("flags a Tech 2 where this client's past quotes almost never had one", quiet.advice[1], "Tech 2 is unusual for this client (0% of 58 past quotes) but is on 3 of 4 quotes checked now: review before sending.");
eq("advice never says to add hours", list.flatMap((c) => c.advice).some((a) => /add (a )?tech|more hours|add hours/i.test(a)), false);
eq("totals", clientTotals(list), { checked: 9, with_t2: 7, red: 4, hours: 18, red_share: 57, clients: 2 });
eq("no client name becomes its own row", clientPatterns([row("n", "", RED, T2(2))], null)[0].client, "(no client)");
eq("no history: no history row, no history advice", clientPatterns([row("n", "Nobody", RED, T2(2))], H)[0].history, null);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
