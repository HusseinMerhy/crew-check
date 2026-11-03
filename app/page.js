"use client";
import { useState } from "react";
import { embedQuote } from "../lib/embed";
import { ENTITIES, lookup, MIN_QUOTES } from "../lib/history";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];

// The bot answers in plain text, and the line a dispatcher actually scans is the summary:
//   OSHA: ... | Safety: ... | Two-person step: ...
// Pull that line, the State line and the "Worth checking" note out of the paragraph so each can
// be shown on its own. Nothing here is required to succeed: when the shape is not found, ok is
// false and the caller prints the answer unchanged, so a wording change in the skill can soften
// the layout but can never blank the screen.
function parseAnswer(text) {
  const lines = String(text || "").split("\n");
  const oshaIdx = lines.findIndex((l) => l.trim().startsWith("OSHA:"));
  const stateIdx = lines.findIndex((l) => l.trim().startsWith("State:"));
  const worthIdx = lines.findIndex((l) => /^worth checking:/i.test(l.trim()));

  const verdicts = [];
  if (oshaIdx >= 0) {
    for (const part of lines[oshaIdx].split("|")) {
      const seg = part.trim();
      const at = seg.indexOf(":");
      if (at < 0) continue;
      verdicts.push({ label: seg.slice(0, at).trim(), value: seg.slice(at + 1).trim() });
    }
  }
  // The summary line is only lifted out of the body once it has produced the three fields the
  // tiles need. Fewer than that and it stays in the body as written: a line is never dropped
  // from the screen just because it did not parse.
  const tiled = verdicts.length >= 3;

  const lifted = new Set([0, tiled ? oshaIdx : -1, stateIdx, worthIdx].filter((i) => i >= 0));
  return {
    ok: oshaIdx >= 0 || stateIdx >= 0,
    headline: (lines[0] || "").trim(),
    verdicts: tiled ? verdicts : [],
    body: lines.filter((_, i) => !lifted.has(i)).join("\n").trim(),
    state: stateIdx >= 0 ? lines[stateIdx].trim() : "",
    worth: worthIdx >= 0 ? lines[worthIdx].trim().replace(/^worth checking:\s*/i, "") : "",
  };
}

// Lime for a rule that requires it, teal for the judgement calls, plain grey for no reason found.
function headlineClass(h) {
  if (/^OSHA requires/i.test(h)) return "required";
  if (/doesn.t show a reason/i.test(h)) return "none";
  return "justified";
}

// Vol 2 history panel. Past practice from our own quotes, worked out in code, never by the model:
// it sits beside the answer and never changes it.
function HistoryPanel({ entity, quote, history }) {
  const label = ENTITIES.find((e) => e.code === entity)?.label || entity;
  let body;
  if (!history) body = <div className="empty">Loading history...</div>;
  else if (!history.ok) body = <div className="empty">{history.problem}</div>;
  else {
    const h = lookup(history.history, entity, quote);
    const pct = (x) => (x == null ? "?" : `${x}%`);
    if (!h.hasEntity) body = <div className="empty">No history for {label} yet: it needs a ClickUp export with the Comp column.</div>;
    else if (!h.entity) body = <div className="empty">Fewer than {MIN_QUOTES} past {label} quotes for {h.job.toLowerCase()}: not enough to show a number.</div>;
    else body = (
      <>
        <div className="answer-body">
          {label} quoted a second tech on <b>{pct(h.entity.t2)}</b> of {h.entity.n.toLocaleString()} past {h.job.toLowerCase()} quotes
          {h.everyone && <> (all entities: {pct(h.everyone.t2)} of {h.everyone.n.toLocaleString()})</>}.
          {" "}A reason was written on {pct(h.entity.reason)} of those{h.entity.t2h != null && <>, and the typical Tech 2 time was {h.entity.t2h} h</>}.
          {h.entity.t3 > 0 && <> A third tech was billed on {pct(h.entity.t3)} of them.</>}
        </div>
        <div className="card-meta" style={{ marginTop: 6 }}>Past practice, not a reason: it never replaces the answer above. Accepted quotes only, final versions.</div>
      </>
    );
  }
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">{label} history</div>
        <div className="panel-title">{history?.ok ? `Job: ${lookup(history.history, entity, quote).job}` : ""}</div>
      </div>
      <div className="panel-body">{body}</div>
    </div>
  );
}

function valueClass(v) {
  const s = v.toLowerCase();
  if (s.startsWith("yes")) return "yes";
  if (s.includes("need")) return "need";
  return "no";
}

export default function Home() {
  const [quote, setQuote] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const [stage, setStage] = useState("");
  const [entity, setEntity] = useState("");
  const [history, setHistory] = useState(null);
  const [taskRef, setTaskRef] = useState("");
  const [imported, setImported] = useState(null);

  // Read-only: fills the form from one ClickUp task. Nothing is sent back to ClickUp.
  async function importTask() {
    setImported({ busy: true });
    try {
      const r = await fetch(`/api/clickup?task=${encodeURIComponent(taskRef)}`);
      const d = await r.json();
      // Every field comes from this task alone: a value ClickUp does not have is cleared, never
      // left over from the previous import, so one quote is never checked with another's state.
      if (d.ok) {
        setQuote(d.quote || "");
        setState(STATES.includes(d.state) ? d.state : "");
        setEntity(ENTITIES.some((e) => e.code === d.entity) ? d.entity : "");
        setRes(null);
      }
      setImported(d);
    } catch (e) { setImported({ ok: false, problem: "Could not reach the import." }); }
  }

  async function check() {
    setBusy(true); setRes(null);
    if (entity && !history) fetch("/api/history").then((r) => r.json()).then(setHistory).catch(() => setHistory({ ok: false, problem: "Could not load the history." }));
    let vector = null;
    try { setStage("Reading the quote's meaning (first time loads a small model)..."); vector = await embedQuote(quote); }
    catch (e) { vector = null; }
    setStage("Checking the rules...");
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote, state, vector }) });
      setRes(await r.json());
    } catch (e) { setRes({ ok: false, problem: "network" }); }
    setBusy(false); setStage("");
  }

  const tooShort = quote.trim().length < 20;
  const answer = res && res.ok ? parseAnswer(res.answer) : null;

  return (
    <main>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Quote</div>
          <div className="panel-title">{quote.length} characters</div>
        </div>
        <div className="panel-body">
          <div className="controls" style={{ marginTop: 0, marginBottom: 10 }}>
            <label className="field-label" htmlFor="task" style={{ margin: 0 }}>From ClickUp</label>
            <input id="task" value={taskRef} onChange={(e) => setTaskRef(e.target.value)} placeholder="Task link or WO number"
              style={{ flex: 1, minWidth: 180 }} />
            <button className="btn" onClick={importTask} disabled={!taskRef.trim() || imported?.busy}>
              {imported?.busy ? "Importing..." : "Import"}
            </button>
          </div>
          {imported && !imported.busy && (
            <div className="stage">
              {imported.ok
                ? <>Imported {imported.task.name} ({imported.task.status}){imported.fm && <>, {imported.fm}</>}{!imported.quote && <>: this task has no Client Quote yet</>}.
                    {!STATES.includes(imported.state) && <> No store state in ClickUp: pick it below.</>}
                    {!ENTITIES.some((e) => e.code === imported.entity) && <> No entity (Comp) in ClickUp: pick it below.</>}
                    {" "}Check the text before pressing Check.</>
                : imported.problem}
            </div>
          )}
          <label className="field-label" htmlFor="quote">Tech reported and required steps</label>
          <textarea id="quote" value={quote} onChange={(e) => setQuote(e.target.value)}
            placeholder={"Paste the Tech Reported line and the Required is to steps.\nUse test or made-up quotes only while the site has no passcode."} />
          <div className="controls">
            <label className="field-label" htmlFor="state" style={{ margin: 0 }}>Store state</label>
            <select id="state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Not given</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="field-label" htmlFor="entity" style={{ margin: 0 }}>Entity</label>
            <select id="entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Not chosen</option>
              {ENTITIES.map((e) => <option key={e.code} value={e.code}>{e.label}</option>)}
            </select>
            <button className="btn primary" onClick={check} disabled={busy || tooShort}>
              {busy ? "Checking..." : "Check this quote"}
            </button>
          </div>
          {busy && <div className="stage">{stage}</div>}
          {!busy && tooShort && quote.length > 0 && <div className="stage">Paste at least 20 characters of the quote.</div>}
        </div>
      </div>

      {res && !res.ok && (
        <div className="panel error">
          <div className="panel-body">Error: {res.problem} {res.detail || ""}</div>
        </div>
      )}

      {res && res.ok && (
        <>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Answer</div>
              <div className="panel-title">{res.state?.code || "No state"}</div>
            </div>
            <div className="panel-body">
              {answer.ok ? (
                <>
                  <div className={`headline ${headlineClass(answer.headline)}`}>{answer.headline}</div>
                  {answer.verdicts.length > 0 && (
                    <div className="verdicts">
                      {answer.verdicts.map((v, i) => (
                        <div className="verdict" key={`${v.label}-${i}`}>
                          <div className="verdict-label">{v.label}</div>
                          <div className={`verdict-value ${valueClass(v.value)}`}>{v.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {answer.body && <div className="answer-body">{answer.body}</div>}
                  {answer.state && <div className="state-line">{answer.state}</div>}
                  {answer.worth && <div className="worth"><b>Worth checking:</b> {answer.worth}</div>}
                </>
              ) : (
                // The answer did not come back in the expected shape (a lone-worker answer carries
                // no summary line at all). Print it exactly as written rather than guessing.
                <div className="answer-body">{res.answer}</div>
              )}
            </div>
          </div>

          {entity && <HistoryPanel entity={entity} quote={quote} history={history} />}

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Rule cards used</div>
              <div className="panel-title">{res.cards.length} found by search</div>
            </div>
            <div className="panel-body">
              {res.cards.length === 0 && <div className="empty">No rule card matched this quote.</div>}
              {/* keyed by position as well as citation: a federal and a state card can carry the
                  same citation, and React drops a row when two keys match */}
              {res.cards.map((c, i) => (
                <div className="card-row" key={`${c.citation}-${i}`}>
                  <span className="card-title">{c.title}</span>
                  <span className="cite">{c.citation}</span>
                  <div className="card-meta">
                    {c.layer} · {c.state}
                    {c.matched.length > 0 && <> · words: {c.matched.join(", ")}</>}
                    {c.similarity != null && <> · meaning match: {c.similarity.toFixed(2)}</>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {res.similar && res.similar.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">Similar past jobs</div>
                <div className="panel-title">Context only, prices and names removed</div>
              </div>
              <div className="panel-body">
                {res.similar.map((s, i) => (
                  <div className="card-row" key={i}>
                    <span className="card-title">{s.job || s.category}</span>
                    <span className="card-meta" style={{ marginLeft: 7 }}>
                      Tech 1 {s.tech1_h ?? "?"} h · Tech 2 {s.tech2_h ?? "?"} h · meaning match {s.similarity.toFixed(2)}
                    </span>
                    <div className="answer-body" style={{ fontSize: 12.5, marginTop: 4 }}>{s.tech_reported}</div>
                    <div className="card-meta">Reason written: {s.reason_found}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {res.similar_hidden && (
            <div className="panel">
              <div className="panel-body empty">Similar past jobs were used but are hidden: turn the passcode on (SITE_PASSCODE) to show them.</div>
            </div>
          )}

          <div className="footnote">
            <span>Search: {res.search}</span>
            <span className="dot">·</span>
            <span>{res.logged ? "saved to log" : "not logged"}</span>
            <span className="dot">·</span>
            <span>Model: {res.model}</span>
            <span className="dot">·</span>
            <span>tokens in {res.usage?.input_tokens ?? "?"}, out {res.usage?.output_tokens ?? "?"}</span>
            {/* Prompt caching went live in PR #3 and is otherwise silent: the requests succeed
                either way and only the bill moves. This number is the only proof it still works,
                so it is on screen rather than in a log. */}
            {res.usage?.cache_read_input_tokens > 0 && (
              <>
                <span className="dot">·</span>
                <span>{res.usage.cache_read_input_tokens} cached</span>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
