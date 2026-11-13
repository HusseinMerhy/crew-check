"use client";
// One client's quote review as a printable page: the browser's Print, or Save as PDF, makes the
// PDF (the way OBI prints its quotes), so no PDF library is needed. Built from /api/clients, the
// same numbers as the Clients page. No dollar amounts. A draft until the manager decides what a
// client may see, and it says so on the page.
import { useEffect, useState } from "react";

const day = (t) => (t ? new Date(t).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "-");
const hrs = (h) => `${Number(h || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;

export default function ClientReport() {
  const [data, setData] = useState(null);
  const [name, setName] = useState(null);
  const [withList, setWithList] = useState(true);

  useEffect(() => {
    setName(new URLSearchParams(window.location.search).get("client") || "");
    fetch("/api/clients", { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => setData({ ok: false, problem: "Could not load the clients." }));
  }, []);

  const c = data?.clients?.find((x) => x.client === name);
  if (!data || name == null) return <div className="empty"><span className="spin" /></div>;
  if (!data.ok) return <div className="lint bad">{data.problem}</div>;
  if (!c) return <div className="lint bad">No checked quotes for "{name}". Open it from the Clients page.</div>;

  return (
    <div className="report">
      <div className="no-print row" style={{ justifyContent: "space-between" }}>
        <a className="btn ghost sm" href="/clients">Back to Clients</a>
        <div className="row">
          <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={withList} onChange={(e) => setWithList(e.target.checked)} style={{ width: "auto", height: "auto" }} />Include the work order list</label>
          <button className="btn pri sm" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </div>

      <header className="report-head">
        <div className="eyebrow">Quote review</div>
        <h1>{c.client}</h1>
        <p className="muted">{c.entities.join(", ") || "All entities"} · {c.checked} quotes checked from {day(data.since)} to {day(new Date())}</p>
      </header>

      <section className="report-tiles">
        <div><div className="lbl">Quotes checked</div><div className="val">{c.checked}</div></div>
        <div><div className="lbl">Tech 2 without a written reason</div><div className="val">{c.red} of {c.with_t2}</div></div>
        <div><div className="lbl">Tech 2 hours without a reason</div><div className="val">{hrs(c.hours_no_reason)}</div></div>
        <div><div className="lbl">Over NTE</div><div className="val">{c.over_nte}</div></div>
        <div><div className="lbl">Overtime without a reason</div><div className="val">{c.ot_no_reason} of {c.ot}</div></div>
      </section>

      {c.advice.length > 0 && (
        <section>
          <h2>What to change in quoting</h2>
          <ol>{c.advice.map((a, i) => <li key={i}>{a}</li>)}</ol>
        </section>
      )}
      {c.jobs.length > 0 && (
        <section>
          <h2>Job types with a Tech 2 and no reason</h2>
          <p>{c.jobs.map((j) => `${j.job}: ${j.red}`).join(" · ")}</p>
        </section>
      )}
      {c.history && (
        <section>
          <h2>Past quotes</h2>
          <p>A Tech 2 on {c.history.t2}% of {c.history.n.toLocaleString("en-US")} past quotes{c.history.reason != null ? `, with a reason written on ${c.history.reason}% of those` : ""}{c.history.t2h ? `, typically ${c.history.t2h} h` : ""}.</p>
        </section>
      )}
      {withList && c.reds.length > 0 && (
        <section>
          <h2>Quotes to fix</h2>
          <table>
            <thead><tr><th>Work order</th><th>Job</th><th>Tech 2</th></tr></thead>
            <tbody>{c.reds.map((r) => <tr key={r.task_id}><td className="mono">{r.task_name}</td><td>{r.job}</td><td className="num">{r.hours ? hrs(r.hours) : "-"}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      {withList && c.others?.length > 0 && (
        <section>
          <h2>Over NTE or overtime without a reason</h2>
          <table>
            <thead><tr><th>Work order</th><th>NTE</th><th>Overtime</th></tr></thead>
            <tbody>{c.others.map((r) => <tr key={r.task_id}><td className="mono">{r.task_name}</td><td>{r.nte_pct ? `${r.nte_pct}% of NTE` : "-"}</td><td>{r.ot ? "No reason written" : "-"}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <footer className="report-foot">
        <p>"Without a reason" means the quote bills a second tech, or overtime, but does not say why. It is a point to fix in the quote, not proof the work did not need it. The overtime rule is not agreed yet.</p>
        <p><b>Draft for internal review.</b> Prepared by Quote Builder on {day(new Date())}. Your manager decides what is shared with the client.</p>
      </footer>
    </div>
  );
}
