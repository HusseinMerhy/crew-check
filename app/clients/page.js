"use client";
// Vol 2: patterns per client. Where a Tech 2 is billed without a written reason, which job types,
// how many hours, and what to change in the quote. Read only: worked out from the stored checks and
// the past-quote history (lib/clients.js), no model call.
import { useEffect, useState } from "react";

const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "-");
const hrs = (h) => `${Number(h || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;

export default function Clients() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setData(await (await fetch("/api/clients", { cache: "no-store" })).json()); }
    catch { setData({ ok: false, problem: "Could not load the clients." }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const list = data?.clients || [];
  const t = data?.totals;
  const max = Math.max(1, ...list.map((c) => c.hours_no_reason));
  const sel = list.find((c) => c.client === open);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Quotes</div>
          <h1>Clients</h1>
          <p>Where a Tech 2 is billed without a written reason, per client.</p>
        </div>
        <div className="act">
          <button className="btn" onClick={load} disabled={loading}>{loading ? <><span className="spin" />Refreshing</> : "Refresh"}</button>
        </div>
      </div>

      {data?.ok && <div className="small muted">From {t?.checked || 0} checked quotes since {day(data.since)}, and past quotes up to {data.history_built || "-"}.</div>}
      {data && !data.ok && <div className="lint bad">{data.problem}</div>}

      <div className="grid g4">
        <div className="card tile"><div className="lbl">Clients</div><div className="val">{t?.clients ?? "-"}</div></div>
        <div className="card tile focus"><div className="lbl">Tech 2, no reason</div><div className="val">{t ? `${t.red} of ${t.with_t2}` : "-"}</div></div>
        <div className="card tile"><div className="lbl">Share</div><div className="val">{t?.red_share != null ? `${t.red_share}%` : "-"}</div></div>
        <div className="card tile"><div className="lbl">Tech 2 hours, no reason</div><div className="val">{t ? hrs(t.hours) : "-"}</div></div>
      </div>

      <div className="card">
        <div className="hd"><h3>By client</h3><span className="small muted">Most Tech 2 hours without a reason first</span></div>
        <div className="tbl-wrap">
          {!data && <div className="empty"><span className="spin" /></div>}
          {data?.ok && list.length === 0 && <div className="empty">No checks yet. The first daily run fills this page.</div>}
          {list.length > 0 && (
            <table>
              <thead><tr><th>Client</th><th>Checked</th><th>Tech 2, no reason</th><th>Hours, no reason</th><th>Past quotes</th><th>Top job</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.client} className="click" onClick={() => setOpen(c.client)}>
                    <td><b>{c.client}</b>{c.entities.length > 0 && <div className="small muted">{c.entities.join(", ")}</div>}</td>
                    <td className="num">{c.checked}</td>
                    <td className="num">{c.with_t2 ? <>{c.red} of {c.with_t2}{c.red_share != null && <span className="muted"> ({c.red_share}%)</span>}</> : <span className="muted">-</span>}</td>
                    <td className="num">
                      <div className="hbar"><i style={{ width: `${Math.round((100 * c.hours_no_reason) / max)}%` }} /></div>
                      {hrs(c.hours_no_reason)}
                    </td>
                    <td className="small">{c.history ? <>Tech 2 on {c.history.t2}% of {c.history.n.toLocaleString("en-US")}{c.history.reason != null && <>, reason on {c.history.reason}%</>}</> : <span className="muted">Not enough past quotes</span>}</td>
                    <td className="small">{c.jobs[0] ? `${c.jobs[0].job} (${c.jobs[0].red})` : <span className="muted">-</span>}</td>
                  </tr>
                ))}
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
                <div className="eyebrow">{sel.entities.join(" · ") || "Client"}</div>
                <h2 style={{ fontSize: 20 }}>{sel.client}</h2>
              </div>
              <button className="x" aria-label="Close" onClick={() => setOpen(null)}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div className="db">
              <div className="facts">
                <div className="fact"><div className="lbl">Tech 2, no reason</div><div className="v">{sel.red} of {sel.with_t2}</div></div>
                <div className="fact"><div className="lbl">Hours, no reason</div><div className="v">{hrs(sel.hours_no_reason)}</div></div>
                <div className="fact"><div className="lbl">Ask first</div><div className="v">{sel.ask}</div></div>
              </div>
              {sel.advice.length > 0 && <><h3>What to change in quoting</h3><ol className="why-list">{sel.advice.map((a, i) => <li key={i}>{a}</li>)}</ol></>}
              {sel.jobs.length > 0 && (
                <>
                  <h3>Job types without a reason</h3>
                  <div className="small">{sel.jobs.map((j) => `${j.job}: ${j.red}`).join(" · ")}</div>
                </>
              )}
              {sel.history && <div className="note sig">Past quotes: a Tech 2 on {sel.history.t2}% of {sel.history.n.toLocaleString("en-US")}{sel.history.reason != null ? `, with a reason written on ${sel.history.reason}% of those` : ""}{sel.history.t2h ? `, typically ${sel.history.t2h} h` : ""}.</div>}
              {sel.reds.length > 0 && (
                <>
                  <h3>Quotes to fix</h3>
                  <table>
                    <thead><tr><th>Work order</th><th>Job</th><th>Tech 2</th><th>Checked</th></tr></thead>
                    <tbody>
                      {sel.reds.map((r) => (
                        <tr key={r.task_id}>
                          <td className="mono">{r.task_url ? <a href={r.task_url} target="_blank" rel="noreferrer">{r.task_name}</a> : r.task_name}</td>
                          <td className="small">{r.job}</td>
                          <td className="num">{r.hours ? hrs(r.hours) : "-"}</td>
                          <td className="small muted">{day(r.checked_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="small muted">"No reason" means the quote bills a Tech 2 but does not say why two people are needed. It is a risk to fix in the quote, not proof the work needed one person.</div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
