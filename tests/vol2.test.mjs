// Unit tests for the Vol 2 pieces that run without a network: the job type, the history lookup
// and the read-only ClickUp import's parsing. No API credit: node tests/vol2.test.mjs
import { jobOf, lookup, MIN_QUOTES } from "../lib/history.js";
import { parseTaskRef, fieldText } from "../lib/clickup.js";

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

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
