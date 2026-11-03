"use client";
// Vol 2: the daily automatic check's results. Each ClickUp quote waiting for approval is checked
// once a day (and again if its quote text changes). Read only: nothing here writes to ClickUp.
import { useEffect, useState } from "react";

function headClass(h) {
  if (/^OSHA requires/i.test(h || "")) return "required";
  if (/doesn.t show a reason/i.test(h || "")) return "none";
  return "justified";
}

export default function Queue() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [running, setRunning] = useState(null);

  const load = () => fetch("/api/clickup/queue").then((r) => r.json()).then(setData).catch(() => setData({ ok: false, problem: "Could not load the results." }));
  useEffect(() => { load(); }, []);

  async function runNow() {
    if (!confirm("Check the waiting ClickUp quotes now? Each quote checked spends API credit (up to 20 per run).")) return;
    setRunning({ busy: true });
    try {
      const r = await fetch("/api/clickup/sync?manual=1");
      setRunning(await r.json());
    } catch { setRunning({ ok: false, problem: "Could not reach the check." }); }
    load();
  }

  const rows = data?.rows || [];
  return (
    <main>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Automatic check</div>
          <div className="panel-title">{data?.auto ? "Runs once a day" : "Daily run is off (CRON_SECRET not set)"}</div>
        </div>
        <div className="panel-body">
          <div className="answer-body">
            Quotes waiting in ClickUp are checked once a day, read only, and listed here newest first.
            A quote is checked again only if its text changes. Each check is the same as the main page, with keyword search.
          </div>
          <div className="controls">
            <button className="btn" onClick={load}>Refresh</button>
            {data?.manual && (
              <button className="btn primary" onClick={runNow} disabled={running?.busy}>{running?.busy ? "Checking..." : "Run now"}</button>
            )}
          </div>
          {running && !running.busy && (
            <div className="stage">
              {running.ok
                ? `Checked ${running.checked}, failed ${running.failed}, unchanged ${running.unchanged}, no quote text ${running.no_quote}${running.left_for_next_run ? ", more waiting for the next run" : ""}.`
                : running.problem}
            </div>
          )}
        </div>
      </div>

      {data && !data.ok && <div className="panel error"><div className="panel-body">{data.problem}</div></div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Results</div>
          <div className="panel-title">{rows.length} quotes</div>
        </div>
        <div className="panel-body">
          {data?.ok && rows.length === 0 && <div className="empty">Nothing checked yet. The first daily run fills this list.</div>}
          {rows.map((r) => (
            <div className="card-row" key={r.task_id} style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.task_id ? null : r.task_id)}>
              <span className="card-title">{r.task_url ? <a href={r.task_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.task_name}</a> : r.task_name}</span>
              <span className="card-meta" style={{ marginLeft: 7 }}>
                {[r.entity, r.fm, r.state, r.status, new Date(r.checked_at).toLocaleString()].filter(Boolean).join(" · ")}
              </span>
              {r.ok
                ? <div className={`headline ${headClass(r.headline)}`} style={{ fontSize: 14, marginTop: 4 }}>{r.headline}</div>
                : <div className="card-meta">Check failed: {r.problem}</div>}
              {r.history && <div className="card-meta">{r.history}</div>}
              {open === r.task_id && r.answer && <div className="answer-body" style={{ marginTop: 6 }}>{r.answer}</div>}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
