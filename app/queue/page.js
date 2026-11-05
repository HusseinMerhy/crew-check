"use client";
// Vol 2: the daily automatic check's results. Each ClickUp quote waiting for approval is checked
// once a day (and again if its quote text changes). Read only: nothing here writes to ClickUp.
import { useEffect, useMemo, useState } from "react";
import { parseAnswer, pointsOf, quoteSnippet, toneOf as tone, valueClass } from "../../lib/answer";

// Same tones as the check page; the queue only needs the short class names.
const CLS = { sig: "sig", warn: "warn", tape: "tape", ok: "ok", wait: "wait" };
// The headline is read from the stored answer (a phased quote opens with the phase name), and
// the quote decides whether "no reason" matters: on a Tech 1 only quote it does not.
const toneOf = (r) => { const t = tone(parseAnswer(r.answer || r.headline || "").headline, r.quote ?? null); return { cls: CLS[t.tone], label: t.label }; };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "tape", label: "Needs a reason" },
  { key: "ok", label: "Justified" },
  { key: "sig", label: "OSHA" },
  { key: "wait", label: "No 2nd tech" },
  { key: "failed", label: "Failed" },
];

// The stored answer, drawn like the check page's verdict card.
function Answer({ text }) {
  const a = parseAnswer(text);
  if (!a.ok) return <div className="prose">{text}</div>;
  return (
    <>
      <h3>{a.headline}</h3>
      {a.verdicts.length > 0 && (
        <div className="facts">
          {a.verdicts.map((v, i) => <div className="fact" key={i}><div className="lbl">{v.label}</div><div className={`v ${valueClass(v.value)}`}>{v.value}</div></div>)}
        </div>
      )}
      {a.body && <ol className="why-list">{pointsOf(a.body).map((x, i) => <li key={i}>{x}</li>)}</ol>}
      {a.worth && <div className="attn"><b>Check:</b> {a.worth}</div>}
      {a.permit && <div className="note warn"><b>Permit:</b> {a.permit}</div>}
    </>
  );
}

export default function Queue() {
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(null);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = () => fetch("/api/clickup/queue").then((r) => r.json()).then(setData).catch(() => setData({ ok: false, problem: "Could not load the results." }));
  useEffect(() => { load(); }, []);

  async function runNow() {
    if (!confirm("Check up to 20 waiting quotes now?")) return;
    setRunning({ busy: true });
    try { setRunning(await (await fetch("/api/clickup/sync?manual=1")).json()); }
    catch { setRunning({ ok: false, problem: "Could not reach the check." }); }
    load();
  }

  const rows = data?.rows || [];
  const keyOf = (r) => (r.ok ? toneOf(r).cls : "failed");
  const counts = useMemo(() => rows.reduce((c, r) => ({ ...c, [keyOf(r)]: (c[keyOf(r)] || 0) + 1 }), {}), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => keyOf(r) === filter);
  const sel = rows.find((r) => r.task_id === open);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Quotes</div>
          <h1>Daily queue</h1>
          <p>Waiting ClickUp quotes, checked daily.</p>
        </div>
        <div className="act">
          <button className="btn" onClick={load}>Refresh</button>
          {data?.manual && <button className="btn pri" onClick={runNow} disabled={running?.busy}>{running?.busy ? <><span className="spin" />Checking</> : "Run check now"}</button>}
        </div>
      </div>

      {data?.ok && (data.history_entities?.length
        ? <div className="small muted">History: {data.history_entities.join(", ")}</div>
        : <div className="small muted">No history loaded</div>)}
      {data && !data.auto && <div className="attn"><b>Daily run is off.</b> Set CRON_SECRET in Vercel.</div>}
      {running && !running.busy && (running.ok
        ? <div className="lint ok">Checked {running.checked} · failed {running.failed}{running.left_for_next_run ? " · more next run" : ""}</div>
        : <div className="lint bad">{running.problem}</div>)}
      {data && !data.ok && <div className="lint bad">{data.problem}</div>}

      <div className="grid g4">
        <div className="card tile"><div className="lbl">Checked</div><div className="val">{rows.length}</div></div>
        <div className="card tile focus"><div className="lbl">Needs a reason</div><div className="val">{counts.tape || 0}</div></div>
        <div className="card tile"><div className="lbl">Justified</div><div className="val">{(counts.ok || 0) + (counts.sig || 0)}</div></div>
        <div className="card tile"><div className="lbl">Check one fact</div><div className="val">{counts.warn || 0}</div></div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Results</h3>
          <div className="row">
            {FILTERS.map((f) => (
              <button key={f.key} className={`btn sm ${filter === f.key ? "pri" : "ghost"}`} onClick={() => setFilter(f.key)}>
                {f.label}{f.key !== "all" && counts[f.key] ? ` ${counts[f.key]}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-wrap">
          {!data && <div className="empty"><span className="spin" /></div>}
          {data?.ok && rows.length === 0 && <div className="empty">Nothing checked yet. The first daily run fills this list.</div>}
          {shown.length > 0 && (
            <table>
              <thead><tr><th>Work order</th><th>Quote</th><th>Entity</th><th>Client</th><th>State</th><th>Verdict</th><th>Checked</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const t = toneOf(r);
                  return (
                    <tr key={r.task_id} className="click" onClick={() => setOpen(r.task_id)}>
                      <td className="mono">{r.task_name}</td>
                      <td className="snip">{quoteSnippet(r.quote) || <span className="muted">{r.quote == null ? "Not loaded yet" : "No quote in ClickUp"}</span>}</td>
                      <td>{r.entity || <span className="muted">-</span>}</td>
                      <td>{r.fm || <span className="muted">-</span>}</td>
                      <td>{r.state || <span className="muted">-</span>}</td>
                      <td>{r.ok ? <span className={`pill ${t.cls}`}><i />{t.label}</span> : <span className="pill close"><i />Failed</span>}</td>
                      <td className="muted small num">{new Date(r.checked_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className={`scrim${sel ? " show" : ""}`} onClick={() => setOpen(null)} />
      <aside className={`drawer${sel ? " show" : ""}`} aria-hidden={!sel}>
        {sel && (
          <>
            <div className="dh">
              <div>
                <div className="eyebrow">{[sel.entity, sel.fm, sel.state, sel.status].filter(Boolean).join(" · ")}</div>
                <h2 className="mono" style={{ fontSize: 18 }}>{sel.task_name}</h2>
              </div>
              <button className="x" aria-label="Close" onClick={() => setOpen(null)}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div className="db">
              {sel.quote
                ? <details className="quote-fold" key={sel.task_id}>
                    <summary><b>Quote</b><span>{quoteSnippet(sel.quote, 70)}</span></summary>
                    <div className="quotebox">{sel.quote}</div>
                  </details>
                : <div className="small muted"><b>Quote:</b> {sel.quote == null ? "not loaded yet, refresh in a moment." : "this task has no Client Quote in ClickUp."}</div>}
              {sel.ok
                ? <Answer text={sel.answer} />
                : <div className="lint bad">Check failed: {sel.problem}. It is tried again on the next run.</div>}
              {sel.history && <div className="note sig">{sel.history}</div>}
              {sel.task_url && <a className="btn" href={sel.task_url} target="_blank" rel="noreferrer">Open in ClickUp</a>}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
