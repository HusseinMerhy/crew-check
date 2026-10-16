"use client";
import { useState } from "react";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];
const C = { navy: "#1F3A5F", grey: "#6B7280", line: "#E3E8EF", red: "#C0392B" };
const box = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginTop: 14 };

export default function Home() {
  const [quote, setQuote] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  async function check() {
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote, state }) });
      setRes(await r.json());
    } catch (e) { setRes({ ok: false, problem: "network" }); }
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ color: C.navy, marginBottom: 4 }}>OSHA check bot</h1>
      <p style={{ color: C.grey, marginTop: 0 }}>Proof of concept: does this quote need a second tech under OSHA?</p>

      <div style={box}>
        <label style={{ fontWeight: "bold", fontSize: 14 }}>Quote</label>
        <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={10}
          placeholder={"Paste the Tech Reported line and the Required is to steps.\nUse test or made-up quotes only while the site has no passcode."}
          style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, fontFamily: "inherit", fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 6 }} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <label style={{ fontWeight: "bold", fontSize: 14 }}>Store state</label>
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: 8, borderRadius: 6, border: `1px solid ${C.line}` }}>
            <option value="">Not given</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={check} disabled={busy || quote.trim().length < 20}
            style={{ marginLeft: "auto", background: C.navy, color: "#fff", border: 0, borderRadius: 6, padding: "10px 20px", fontWeight: "bold", cursor: "pointer", opacity: busy || quote.trim().length < 20 ? 0.5 : 1 }}>
            {busy ? "Checking..." : "Check"}
          </button>
        </div>
      </div>

      {res && !res.ok && (
        <div style={{ ...box, borderColor: C.red, color: C.red }}>Error: {res.problem} {res.detail || ""}</div>
      )}

      {res && res.ok && (
        <>
          <div style={box}>
            <div style={{ fontSize: 12, color: C.grey, marginBottom: 8 }}>Answer</div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 15 }}>{res.answer}</div>
          </div>
          <div style={box}>
            <div style={{ fontSize: 12, color: C.grey, marginBottom: 8 }}>Cards used (what the search found)</div>
            {res.cards.length === 0 && <div style={{ color: C.grey }}>No rule card matched this quote.</div>}
            {res.cards.map((c) => (
              <div key={c.citation} style={{ padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
                <b>{c.title}</b> <span style={{ color: C.red, fontFamily: "monospace" }}>{c.citation}</span>
                <div style={{ fontSize: 12, color: C.grey }}>{c.layer} · {c.state} · matched: {c.matched.join(", ")}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.grey, marginTop: 8 }}>
            Model: {res.model} · tokens in {res.usage?.input_tokens ?? "?"}, out {res.usage?.output_tokens ?? "?"}
          </div>
        </>
      )}
    </main>
  );
}
