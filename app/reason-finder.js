"use client";
// The reason finder: paste the call or the texts with the tech, and see whether they say why two
// people are needed (lib/reason.js). Shown under a quote whose verdict is NO REASON.
import { useState } from "react";

export default function ReasonFinder({ quote }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  async function find() {
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/reason", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote, conversation: text }) });
      setRes(await r.json());
    } catch { setRes({ ok: false, problem: "Could not reach the tool." }); }
    finally { setBusy(false); }
  }

  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Find the reason in the tech's words</button>;
  return (
    <div className="card finder">
      <div className="lbl">Find the reason in the tech's words</div>
      <div className="small muted">Paste the call transcript or the texts with the tech about this job. The tool shows the words that give a two-person reason, if there are any, and a sentence for the quote. Nothing is saved.</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Tech: the door is about 300 lb, I need someone to hold it while I set the hinges\nDispatcher: ok"} style={{ minHeight: 120 }} />
      <div className="row">
        <button className="btn pri sm" onClick={find} disabled={busy || text.trim().length < 30}>{busy ? <><span className="spin" />Reading</> : "Find the reason"}</button>
        <button className="btn ghost sm" onClick={() => { setOpen(false); setRes(null); }}>Close</button>
      </div>
      {res && !res.ok && <div className="lint bad">{res.problem}</div>}
      {res?.ok && res.found && (
        <>
          <div className="note sig"><b>The tech said:</b> "{res.words}"</div>
          <div className="cu-field"><div className="lbl">Add to the quote</div><div className="v">{res.step}</div></div>
          <div className="small muted">Check it reads true before adding it. The check runs again when the quote changes.</div>
        </>
      )}
      {res?.ok && !res.found && <div className="lint warn">{res.note}</div>}
    </div>
  );
}
