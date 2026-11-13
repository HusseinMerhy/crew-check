// Vol 2: patterns per client (the FM), for the Clients page. Worked out in code from two sources,
// never by the model:
//   - the checks the tool has made (auto_checks): what each quote's verdict is today;
//   - ENTITY_HISTORY: how often a Tech 2 was quoted, and written up with a reason, in past quotes.
// "Tech 2 hours without a reason" is the overcharge risk: hours billed for a second person on a
// quote that does not say why two people are needed. It is a risk to fix in the quote, not proof
// that the work did not need two people.
import { crewCheckLine } from "./fieldline.js";
import { secondTechHours } from "./answer.js";
import { clientKey, rowOf, MIN_QUOTES } from "./history.js";

// The verdict keyword of a field line, without the phase: "NO REASON (Additional)" -> "NO REASON".
export const verdictOf = (line) => String(line || "").split(":")[0].replace(/\s*\(.*\)$/, "").trim() || null;

// Job types the skill treats as one-person by default, so a Tech 2 there needs a clear reason.
const ONE_PERSON_JOBS = new Set(["Snake / clog / drain", "Toilet / urinal", "Cleaning", "Lights / fixtures", "Sink / faucet", "Lock / key"]);

const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);

export function clientPatterns(rows, history) {
  const by = new Map();
  for (const r of rows) {
    if (!r.ok || !r.answer) continue;
    const client = String(r.fm || "").trim() || "(no client)";
    const c = by.get(client) ?? by.set(client, { client, checked: 0, red: 0, ask: 0, green: 0, one: 0, hours: 0, jobs: new Map(), entities: new Set(), reds: [] }).get(client);
    const line = crewCheckLine(r.answer, r.quote);
    const v = verdictOf(line);
    c.checked++;
    if (r.entity) c.entities.add(r.entity);
    if (v === "NO REASON") {
      c.red++;
      const h = secondTechHours(r.quote) || 0;
      c.hours += h;
      const job = r.job || "Other";
      c.jobs.set(job, (c.jobs.get(job) || 0) + 1);
      c.reds.push({ task_id: r.task_id, task_name: r.task_name, task_url: r.task_url || null, job, hours: h, line, checked_at: r.checked_at });
    } else if (v === "ASK FIRST") c.ask++;
    else if (v === "ONE TECH") c.one++;
    else c.green++;
  }

  return [...by.values()].map((c) => {
    const withT2 = c.checked - c.one;
    const ck = clientKey(history, c.client);
    const hist = ck ? rowOf(history.clients[ck]?.all) : null;
    const jobs = [...c.jobs].sort((a, b) => b[1] - a[1]).map(([job, n]) => ({ job, red: n }));
    return {
      client: c.client,
      entities: [...c.entities].sort(),
      checked: c.checked,
      with_t2: withT2,
      red: c.red, ask: c.ask, green: c.green, one: c.one,
      red_share: pct(c.red, withT2),
      hours_no_reason: Math.round(c.hours * 10) / 10,
      jobs,
      history: hist && hist.n >= MIN_QUOTES ? { n: hist.n, t2: hist.t2, reason: hist.reason, t2h: hist.t2h } : null,
      advice: adviceFor(c, withT2, jobs, hist),
      reds: c.reds.sort((a, b) => b.hours - a.hours).slice(0, 25),
    };
  }).sort((a, b) => b.hours_no_reason - a.hours_no_reason || b.red - a.red || a.client.localeCompare(b.client));
}

// Plain advice from the patterns, at most three lines, worst first. Each line says what to change
// in the quote, never to add hours.
const quotes = (n) => (n === 1 ? "1 quote" : `${n} quotes`);
function adviceFor(c, withT2, jobs, hist) {
  const out = [];
  if (c.red) out.push(`${c.red} of ${withT2} Tech 2 quotes don't say why two people are needed: write the two-person step or quote one tech.`);
  // A Tech 2 where this client's past quotes almost never had one.
  if (hist && hist.n >= MIN_QUOTES && hist.t2 != null && hist.t2 < 15 && c.checked >= 4 && withT2 / c.checked >= 0.5) {
    out.push(`Tech 2 is unusual for this client (${hist.t2}% of ${hist.n.toLocaleString("en-US")} past quotes) but is on ${withT2} of ${c.checked} quotes checked now: review before sending.`);
  }
  const lone = jobs.find((j) => ONE_PERSON_JOBS.has(j.job));
  if (lone) out.push(`${lone.job} is usually one-person work: review the Tech 2 on ${lone.red === 1 ? "that quote" : `those ${lone.red} quotes`}.`);
  if (hist && hist.n >= MIN_QUOTES && hist.reason != null && hist.reason < 50) {
    out.push(`In past quotes only ${hist.reason}% of this client's Tech 2 quotes had a reason written (${hist.n.toLocaleString("en-US")} quotes).`);
  }
  if (c.ask) out.push(`${quotes(c.ask)} wait${c.ask === 1 ? "s" : ""} on one fact (for example combustibles near hot work): confirm it before sending.`);
  return out.slice(0, 3);
}

// Totals for the tiles at the top of the page.
export function clientTotals(list) {
  const t = list.reduce((a, c) => ({ checked: a.checked + c.checked, with_t2: a.with_t2 + c.with_t2, red: a.red + c.red, hours: a.hours + c.hours_no_reason }), { checked: 0, with_t2: 0, red: 0, hours: 0 });
  return { ...t, hours: Math.round(t.hours * 10) / 10, red_share: pct(t.red, t.with_t2), clients: list.length };
}
