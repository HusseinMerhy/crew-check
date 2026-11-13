"use client";
// Does the flag change anything? Quotes flagged NO REASON and what became of them, and the
// "Quote Check" tick in ClickUp against the tool's verdict. Read only: worked out from this app's
// own tables (lib/impact.js), no model call, nothing read from or written to ClickUp here.
import { useEffect, useState } from "react";

const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "-");
const hrs = (h) => `${Number(h || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;

export default function Fixes() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try { setData(await (await fetch("/api/impact", { cache: "no-store" })).json()); }
    catch { setData({ ok: false, problem: "Could not load the results." }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const t = data?.totals, q = data?.quote_check, tasks = data?.tasks || [];
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Quotes</div>
          <h1>Fixes</h1>
          <p>What happened to quotes after the tool flagged them.</p>
        </div>
        <div className="act">
          <button className="btn" onClick={load} disabled={loading}>{loading ? <><span className="spin" />Refreshing</> : "Refresh"}</button>
        </div>
      </div>

      {data && !data.ok && <div className="lint bad">{data.problem}</div>}
      {data?.ok && <div className="small muted">Versions kept since {day(data.since) === "-" ? "the next run" : day(data.since)} · {data.checked} quotes checked · {data.followed} read again from ClickUp</div>}

      <div className="grid g4">
        <div className="card tile"><div className="lbl">Flagged no reason</div><div className="val">{t?.flagged ?? "-"}</div></div>
        <div className="card tile focus"><div className="lbl">Fixed after the flag</div><div className="val">{t ? `${t.fixed}` : "-"}</div>{t?.fixed_share != null && <div className="sub">{t.fixed_share}% of flagged</div>}</div>
        <div className="card tile"><div className="lbl">Tech 2 hours taken off</div><div className="val">{t ? hrs(t.hours_cut) : "-"}</div></div>
        <div className="card tile"><div className="lbl">Still no reason</div><div className="val">{t?.still_red ?? "-"}</div></div>
      </div>
      {t && t.fixed > 0 && <div className="small muted">Of the fixed: reason added {t.reason_added} · Tech 2 removed {t.t2_removed} · Tech 2 hours cut {t.t2_cut}. This counts what changed after the flag, not why it changed.</div>}

      <div className="card">
        <div className="hd"><h3>Quote Check in ClickUp</h3><span className="small muted">The tick, against the tool's verdict</span></div>
        <div className="bd stack">
          {q && q.known === 0 && <div className="empty">Not read yet. Each daily run reads the tick on waiting quotes, and on up to 25 older ones.</div>}
          {q && q.known > 0 && (
            <div className="tbl-wrap"><table>
              <thead><tr><th>Tool says</th><th>Quotes</th><th>Quote Check ticked</th></tr></thead>
              <tbody>
                <tr><td>No reason (still red)</td><td className="num">{q.red}</td><td className="num">{q.red_ticked}{q.red_ticked_share != null && <span className="muted"> ({q.red_ticked_share}%)</span>}</td></tr>
                <tr><td>Justified, one tech, or fixed</td><td className="num">{q.green}</td><td className="num">{q.green_ticked}{q.green_ticked_share != null && <span className="muted"> ({q.green_ticked_share}%)</span>}</td></tr>
              </tbody>
            </table></div>
          )}
          <div className="note">In OBI's ClickUp sample the box was ticked at done or invoiced, never at quote ready, so it looks like a review later in the job, not the TL's check before sending. A red quote that was ticked is one to look at: either that review does not look at Tech 2, or the flag was wrong. Sample a few before drawing a conclusion.</div>
        </div>
      </div>

      <div className="card">
        <div className="hd"><h3>Flagged quotes</h3><span className="small muted">Fixed first</span></div>
        <div className="tbl-wrap">
          {!data && <div className="empty"><span className="spin" /></div>}
          {data?.ok && tasks.length === 0 && <div className="empty">No quote flagged yet.</div>}
          {tasks.length > 0 && (
            <table>
              <thead><tr><th>Work order</th><th>Client</th><th>Outcome</th><th>Tech 2</th><th>Quote Check</th><th>Flagged</th></tr></thead>
              <tbody>
                {tasks.map((x) => (
                  <tr key={x.task_id}>
                    <td className="mono">{x.task_url ? <a href={x.task_url} target="_blank" rel="noreferrer">{x.task_name}</a> : x.task_name}</td>
                    <td>{x.fm || <span className="muted">-</span>}</td>
                    <td>{x.fixed ? <span className="pill ok"><i />{x.how}</span> : <span className="pill tape"><i />Still no reason</span>}{x.unchecked_change && <div className="small muted">Changed in ClickUp, not checked again</div>}</td>
                    <td className="num">{x.end_t2 !== x.red_t2 ? `${hrs(x.red_t2)} to ${hrs(x.end_t2)}` : hrs(x.red_t2)}</td>
                    <td className="small">{x.quote_check == null ? <span className="muted">Not read</span> : x.quote_check ? "Ticked" : "Not ticked"}</td>
                    <td className="small muted">{day(x.red_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
