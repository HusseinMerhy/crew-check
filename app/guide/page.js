"use client";
// The field guide for TLs: every line the OSHA Check field in ClickUp can show, the decision it
// means, and the words to tell the dispatcher (lib/guide.js, the same words as the queue panel).
// Printable: the browser's Print, or Save as PDF.
import { GUIDE, NOTES } from "../../lib/guide";

function Entry({ g, mono = true }) {
  return (
    <div className="card guide-card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className={mono ? "mono guide-line" : "guide-line"}>{g.line || g.key}</div>
        <span className={`pill ${g.tone}`}><i />{g.decision}</span>
      </div>
      <div><div className="lbl">What it means</div><p>{g.means}</p></div>
      <div className="tell"><div className="lbl">Tell the dispatcher</div><p>{g.tell}</p></div>
    </div>
  );
}

export default function Guide() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Quotes</div>
          <h1>Field guide</h1>
          <p>What the OSHA Check field says, and what to tell the dispatcher.</p>
        </div>
        <div className="act no-print">
          <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </div>

      <div className="card">
        <div className="hd"><h3>How it runs</h3></div>
        <div className="bd">
          <ol className="why-list">
            <li><div>The dispatcher moves the work order to <b>quote ready</b>. About 15 seconds later the OSHA Check field in ClickUp shows one line from the list below.</div></li>
            <li><div>The TL reads the line and gives the dispatcher the matching instruction.</div></li>
            <li><div>After the dispatcher edits the quote, they move the work order back to <b>quote ready</b>. The quote is checked again and the field updates.</div></li>
            <li><div>The first word never changes, so a ClickUp view filtered on "NO REASON" or "ASK FIRST" lists every quote to fix.</div></li>
          </ol>
        </div>
      </div>

      <h2 className="guide-h">What the field can say</h2>
      <div className="guide-grid">{GUIDE.map((g) => <Entry key={g.key} g={g} />)}</div>
      <p className="small muted">A quote in phases shows the phase that most needs attention, for example "NO REASON (Additional): ...". The instruction is the same.</p>

      <h2 className="guide-h">Also shown in the tool (not in ClickUp)</h2>
      <div className="guide-grid">{NOTES.map((g) => <Entry key={g.key} g={g} mono={false} />)}</div>
    </>
  );
}
