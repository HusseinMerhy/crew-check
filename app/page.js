"use client";
// Check a quote: everything on one screen. The quote on the left (import from ClickUp, or paste),
// the answer on the right: the verdict, the entity's history, and the rule cards behind it.
import { useEffect, useState } from "react";
import { embedQuote } from "../lib/embed";
import { ENTITIES, lookup, MIN_QUOTES } from "../lib/history";
import { parseAnswer, pointsOf, toneOf, valueClass } from "../lib/answer";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];

const ICON = {
  shield: <svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  help: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" /></svg>,
  alert: <svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></svg>,
  check: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
};

function Verdict({ res }) {
  const a = parseAnswer(res.answer);
  if (!a.ok) {
    // A lone-worker answer carries no summary line at all. Print it exactly as written.
    return <div className="card"><div className="bd"><div className="prose">{res.answer}</div></div></div>;
  }
  const t = toneOf(a.headline);
  return (
    <div className={`card verdict-card tone-${t.tone}`}>
      <div className="bd stack">
        <div className={`verdict-head tone-${t.tone}`}>
          <div className="badge">{ICON[t.icon]}</div>
          <div>
            <div className="eyebrow">{t.label}{res.state?.code ? ` · ${res.state.code}` : ""}</div>
            <h2>{a.headline}</h2>
          </div>
        </div>
        {a.verdicts.length > 0 && (
          <div className="facts">
            {a.verdicts.map((v, i) => (
              <div className="fact" key={`${v.label}-${i}`}>
                <div className="lbl">{v.label}</div>
                <div className={`v ${valueClass(v.value)}`}>{v.value}</div>
              </div>
            ))}
          </div>
        )}
        {a.worth && <div className={t.tone === "tape" ? "attn" : "note sig"}><b>Check:</b> {a.worth}</div>}
        {a.permit && <div className="note warn"><b>Permit:</b> {a.permit}</div>}
        {a.state && <div className="small muted">{a.state}</div>}
      </div>
    </div>
  );
}

// The explanation as numbered points in a card of its own: the first few show, the rest are one
// click away, so a long answer never buries the verdict or the history.
const SHOW_POINTS = 3;
function Why({ res }) {
  const a = parseAnswer(res.answer);
  const points = a.ok ? pointsOf(a.body) : [];
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [res]);
  if (!points.length) return null;
  const shown = all ? points : points.slice(0, SHOW_POINTS);
  return (
    <div className="card">
      <div className="hd"><h3>Why</h3></div>
      <div className="bd stack">
        <ol className="why-list">{shown.map((x, i) => <li key={i}>{x}</li>)}</ol>
        {points.length > SHOW_POINTS && (
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>
            {all ? "Show less" : `Show all ${points.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

// Past practice from our own quotes, worked out in code, never by the model: it sits beside the
// answer and never changes it.
function History({ entity, quote, history }) {
  const label = ENTITIES.find((e) => e.code === entity)?.label || entity;
  const h = history?.ok ? lookup(history.history, entity, quote) : null;
  let body;
  if (!history) body = <div className="row muted"><span className="spin" /> Loading</div>;
  else if (!history.ok) body = <div className="muted">{history.problem}</div>;
  else if (!h.hasEntity) body = <div className="muted">No numbers for {label} yet.</div>;
  else if (!h.entity) body = <div className="muted">Too few past {h.job.toLowerCase()} quotes (under {MIN_QUOTES}).</div>;
  else body = (
    <div className="stack">
      <div className="big2">
        <div className="me">
          <div className="lbl">{label}</div>
          <div className="val num">{h.entity.t2}%</div>
          <div className="trk"><div className="fill" style={{ width: `${h.entity.t2}%` }} /></div>
        </div>
        {h.everyone && (
          <div>
            <div className="lbl">All entities</div>
            <div className="val num">{h.everyone.t2}%</div>
            <div className="trk"><div className="fill" style={{ width: `${h.everyone.t2}%` }} /></div>
          </div>
        )}
      </div>
      <div className="row">
        <span className="pill wait num">{h.entity.n.toLocaleString()} past quotes</span>
        <span className="pill wait num">Reason written {h.entity.reason ?? "?"}%</span>
        {h.entity.t2h != null && <span className="pill wait num">Tech 2 usually {h.entity.t2h} h</span>}
        {h.entity.t3 > 0 && <span className="pill wait num">3rd tech {h.entity.t3}%</span>}
      </div>
      <div className="small muted">Past practice, not a rule.</div>
    </div>
  );
  return (
    <div className="card">
      <div className="hd"><h3>How often {label} gets a 2nd tech</h3>{h && <span className="pill sig">{h.job}</span>}</div>
      <div className="bd">{body}</div>
    </div>
  );
}

function RuleCards({ cards }) {
  return (
    <div className="card">
      <div className="hd"><h3>Rules used</h3><span className="muted small">{cards.length}</span></div>
      <div className="bd tight list">
        {cards.length === 0 && <div className="empty">No rule card matched this quote.</div>}
        {/* keyed by position as well as citation: a federal and a state card can carry the same
            citation, and React drops a row when two keys match */}
        {cards.map((c, i) => (
          <div className="li" key={`${c.citation}-${i}`}>
            <div style={{ minWidth: 0 }}>
              <div className="ttl">{c.title}</div>
              <div className="sub">
                {c.layer} · {c.state}
                {c.matched.length > 0 && <> · words: {c.matched.join(", ")}</>}
                {c.similarity != null && <> · meaning match {c.similarity.toFixed(2)}</>}
              </div>
            </div>
            <span className="sp" />
            <span className="chip">{c.citation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimilarJobs({ res }) {
  if (!res.similar?.length) return null;
  return (
    <div className="card">
      <div className="hd"><h3>Similar past jobs</h3><span className="muted small">{res.similar.length}</span></div>
      <div className="bd tight list">
        {res.similar.map((s, i) => (
          <div className="li" key={i}>
            <div style={{ minWidth: 0 }}>
              <div className="ttl">{s.job || s.category}</div>
              <div className="sub">Tech 1 {s.tech1_h ?? "?"} h · Tech 2 {s.tech2_h ?? "?"} h · meaning match {s.similarity.toFixed(2)}</div>
              <div className="small" style={{ marginTop: 6 }}>{s.tech_reported}</div>
              <div className="sub">Reason written: {s.reason_found}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [quote, setQuote] = useState("");
  const [state, setState] = useState("");
  const [entity, setEntity] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [res, setRes] = useState(null);
  const [history, setHistory] = useState(null);
  const [taskRef, setTaskRef] = useState("");
  const [imported, setImported] = useState(null);

  // Read-only: fills the form from one ClickUp task. Nothing is sent back to ClickUp.
  // Every field comes from this task alone: a value ClickUp does not have is cleared, never left
  // over from the previous import, so one quote is never checked with another's state.
  async function importTask(e) {
    e?.preventDefault();
    if (!taskRef.trim()) return;
    setImported({ busy: true });
    try {
      const r = await fetch(`/api/clickup?task=${encodeURIComponent(taskRef)}`);
      const d = await r.json();
      if (d.ok) {
        setQuote(d.quote || "");
        setState(STATES.includes(d.state) ? d.state : "");
        setEntity(ENTITIES.some((x) => x.code === d.entity) ? d.entity : "");
        setRes(null);
      }
      setImported(d);
    } catch { setImported({ ok: false, problem: "Could not reach the import." }); }
  }

  async function check() {
    setBusy(true); setRes(null);
    if (entity && !history) fetch("/api/history").then((r) => r.json()).then(setHistory).catch(() => setHistory({ ok: false, problem: "Could not load the history." }));
    let vector = null;
    try { setStage("Reading the quote"); vector = await embedQuote(quote); }
    catch { vector = null; }
    setStage("Checking");
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote, state, vector }) });
      setRes(await r.json());
    } catch { setRes({ ok: false, problem: "Could not reach the checker." }); }
    setBusy(false); setStage("");
  }

  const tooShort = quote.trim().length < 20;
  const missing = imported?.ok ? [!STATES.includes(imported.state) && "store state", !ENTITIES.some((x) => x.code === imported.entity) && "entity"].filter(Boolean) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Quotes</div>
          <h1>Check a quote</h1>
          <p>Is the second tech justified?</p>
        </div>
      </div>

      <div className="split">
        <div className="sticky stack">
          <div className="card">
            <div className="hd"><h3>Import from ClickUp</h3><span className="pill wait">Read only</span></div>
            <form className="bd stack" onSubmit={importTask}>
              <div className="inline">
                <input id="task" aria-label="ClickUp task link or WO number" value={taskRef} onChange={(e) => setTaskRef(e.target.value)} placeholder="WO number or link" />
                <button className="btn" type="submit" disabled={!taskRef.trim() || imported?.busy}>
                  {imported?.busy ? <span className="spin" /> : ICON.download}Import
                </button>
              </div>
              {imported && !imported.busy && (imported.ok
                ? <div className="lint ok">
                    <span><b>{imported.task.name}</b>{imported.fm && <> · {imported.fm}</>}
                      {!imported.quote && <> · no quote yet</>}
                      {missing.length > 0 && <> · pick {missing.join(" and ")}</>}
                    </span>
                  </div>
                : <div className="lint bad">{imported.problem}</div>)}
            </form>
          </div>

          <div className="card">
            <div className="hd"><h3>Quote</h3></div>
            <div className="bd stack">
              <textarea id="quote" aria-label="Quote" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Paste the quote" />
              <div className="frm">
                <div className="field">
                  <label htmlFor="state">State</label>
                  <select id="state" value={state} onChange={(e) => setState(e.target.value)}>
                    <option value="">Not given</option>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="entity">Entity</label>
                  <select id="entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
                    <option value="">Not chosen</option>
                    {ENTITIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn pri lg wide" onClick={check} disabled={busy || tooShort}>
                {busy ? <><span className="spin" />Checking</> : "Check"}
              </button>
            </div>
          </div>
        </div>

        <div className="stack">
          {!res && !busy && (
            <div className="card">
              <div className="bd">
                <ol className="steps3" style={{ margin: 0, padding: 0 }}>
                  <li><div><b>Import or paste the quote</b></div></li>
                  <li><div><b>Pick state and entity</b></div></li>
                  <li><div><b>Check</b></div></li>
                </ol>
              </div>
            </div>
          )}
          {busy && <div className="card"><div className="bd row muted"><span className="spin" />{stage}</div></div>}
          {res && !res.ok && <div className="lint bad">Error: {res.problem} {res.detail || ""}</div>}
          {res?.ok && (
            <>
              <Verdict res={res} />
              {entity && <History entity={entity} quote={quote} history={history} />}
              <Why res={res} />
              <RuleCards cards={res.cards} />
              <SimilarJobs res={res} />
              {/* Prompt caching is otherwise silent: the requests succeed either way and only the bill
                  moves. The token counts, on hover, are the only proof it still works. */}
              <div className="foot" title={`Tokens in ${res.usage?.input_tokens ?? "?"}, out ${res.usage?.output_tokens ?? "?"}, cached ${res.usage?.cache_read_input_tokens ?? 0}. ${res.logged ? "Saved to log." : "Not logged."}`}>
                <span>{res.model} · {res.search}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
