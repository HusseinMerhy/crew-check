"use client";
import { useState } from "react";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];
const C = { navy: "#1F3A5F", grey: "#6B7280", line: "#E3E8EF", red: "#C0392B" };
const box = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: 16, marginTop: 14 };

// Meaning search, step 1: turn the quote into a meaning vector IN THE BROWSER, with the same free model
// used to place the cards and past quotes (all-MiniLM-L6-v2, 384 numbers). First use downloads it (~25 MB).
let embedderPromise = null;
async function embedQuote(text) {
  if (!embedderPromise) {
    embedderPromise = import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6")
      .then(({ pipeline }) => pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" }));
    // Forget a failed download so the next Check tries again. Without this the rejected promise
    // stays cached, every later Check waits on the same old failure, and meaning search is dead
    // for the rest of the visit even after the connection comes back.
    embedderPromise.catch(() => { embedderPromise = null; });
  }
  const fe = await embedderPromise;
  const out = await fe(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export default function Home() {
  const [quote, setQuote] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const [stage, setStage] = useState("");

  async function check() {
    setBusy(true); setRes(null);
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
        {busy && <div style={{ fontSize: 12, color: C.grey, marginTop: 8 }}>{stage}</div>}
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
            {/* keyed by position as well as citation: a federal and a state card can carry the
                same citation, and React drops a row when two keys match */}
            {res.cards.map((c, i) => (
              <div key={`${c.citation}-${i}`} style={{ padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
                <b>{c.title}</b> <span style={{ color: C.red, fontFamily: "monospace" }}>{c.citation}</span>
                <div style={{ fontSize: 12, color: C.grey }}>
                  {c.layer} · {c.state}
                  {c.matched.length > 0 && <> · words: {c.matched.join(", ")}</>}
                  {c.similarity != null && <> · meaning match: {c.similarity.toFixed(2)}</>}
                </div>
              </div>
            ))}
          </div>
          {res.similar && res.similar.length > 0 && (
            <div style={box}>
              <div style={{ fontSize: 12, color: C.grey, marginBottom: 8 }}>Similar past jobs (context only, prices and names removed)</div>
              {res.similar.map((s, i) => (
                <div key={i} style={{ padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
                  <b>{s.job || s.category}</b> <span style={{ color: C.grey, fontSize: 12 }}>Tech 1 {s.tech1_h ?? "?"} h · Tech 2 {s.tech2_h ?? "?"} h · meaning match {s.similarity.toFixed(2)}</span>
                  <div style={{ fontSize: 13 }}>{s.tech_reported}</div>
                  <div style={{ fontSize: 12, color: C.grey }}>Reason written: {s.reason_found}</div>
                </div>
              ))}
            </div>
          )}
          {res.similar_hidden && (
            <div style={{ ...box, color: C.grey, fontSize: 13 }}>Similar past jobs were used but are hidden: turn the passcode on (SITE_PASSCODE) to show them.</div>
          )}
          <div style={{ fontSize: 12, color: C.grey, marginTop: 8 }}>
            Search: {res.search} · {res.logged ? "saved to log" : "not logged"} · Model: {res.model} · tokens in {res.usage?.input_tokens ?? "?"}, out {res.usage?.output_tokens ?? "?"}
          </div>
        </>
      )}
    </main>
  );
}
