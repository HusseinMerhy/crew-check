"use client";
// The eval runner, in the browser, on the deployed site.
//
// Same scoring as evals/run_eval.js (both use evals/scoring.js) and the same KPI arithmetic as
// evals/compare.js (both use evals/kpi.js), so a number from here means what a number from the
// Node runner means. Two things it does that the Node runner cannot:
// - it needs no API key on the machine that runs it: it calls this site's /api/check, and the
//   deployment holds the key;
// - it can send the meaning vector (lib/embed.js), so retrieval takes the path users get, not the
//   keyword-only path every Node run is stuck on.
//
// Every check spends real API credit. The page sits behind the same passcode as the rest of the
// site (middleware.js). Agentic runs need AGENTIC_RETRIEVAL=on on the deployment; without it each
// agentic case is marked ERROR, never scored as if it were agentic.
//
// The case files and the two data files the scorer parses are fetched from the repository at the
// commit this build came from, so the ruler matches the code it measures. That needs the
// repository to be public. Holdout runs are shown and copied as totals only.
import { useRef, useState } from "react";
import { createScorer, parseCases, stateOf, summarize, toResult } from "../../evals/scoring";
import { footnotes, holdoutTable, kpiTable, money, summarizeResult } from "../../evals/kpi";
import PRICES from "../../evals/prices.json";
import { embedQuote } from "../../lib/embed";

const REPO_RAW = "https://raw.githubusercontent.com/HusseinMerhy/crew-check";
const REF = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "main";

async function raw(file) {
  const r = await fetch(`${REPO_RAW}/${REF}/${file}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Could not load ${file} from GitHub (HTTP ${r.status}). The page reads the case files from the public repository.`);
  return r.text();
}

// Runs async tasks with at most `n` in flight.
async function pool(tasks, n) {
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

// One case against /api/check, scored. Latency is the request alone, as in the Node runner; the
// vector is built first and not timed.
async function checkOne(c, mode, scorer, useVectors) {
  const state = stateOf(c.quote_text);
  const row = { id: c.id, state, expected: c.expected_verdict, expected_issue_type: c.expected_issue_type };
  let vector = null, vectorError = null;
  if (useVectors) {
    try { vector = await embedQuote(c.quote_text); } catch { vectorError = "The meaning model did not load, so some checks ran keyword-only."; }
  }
  const started = performance.now();
  let d;
  try {
    const r = await fetch("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: c.quote_text, state, vector, ...(mode === "agentic" ? { mode: "agentic" } : {}) }),
    });
    row.http = r.status;
    try {
      d = await r.json();
      row.latency_ms = Math.round(performance.now() - started);
    } catch (e) {
      const hint = r.status === 401 ? "401: open this page with the site passcode" : `not JSON (${String(e).slice(0, 80)})`;
      return { scored: { ...row, result: "ERROR", why: [hint] }, vectorError };
    }
  } catch (e) {
    return { scored: { ...row, result: "ERROR", why: [`network: ${String(e).slice(0, 120)}`] }, vectorError };
  }
  const scored = scorer.scoreReply(c, d, row, mode);
  return { scored, model: scored.result === "ERROR" ? "" : d.model, vectorSent: !!vector, vectorError };
}

// The decision rule for agentic search, written down before any real run and the same as the
// proof slide in the deck: switch it on only if every agentic main-set run passes more cases than
// the fixed run, the holdout does not get worse, agentic cites nothing outside the library, and no
// run had an errored case.
function decide(runs) {
  const fixedMain = runs.find((x) => x.set === "cases" && x.mode === "fixed");
  const agMain = runs.filter((x) => x.set === "cases" && x.mode === "agentic");
  const fixedHold = runs.find((x) => x.set === "holdout" && x.mode === "fixed");
  const agHold = runs.find((x) => x.set === "holdout" && x.mode === "agentic");
  if (!fixedMain || agMain.length < 2 || !fixedHold || !agHold) {
    return { ready: false, text: "The verdict needs the fixed run and two agentic runs on the main set, plus both on the holdout." };
  }
  const ag = [...agMain, agHold];
  const checks = [
    { name: `Every agentic main-set run passes more cases than fixed (${fixedMain.result.passed})`, ok: agMain.every((a) => a.result.passed > fixedMain.result.passed), got: agMain.map((a) => a.result.passed).join(" and ") },
    { name: "The holdout does not get worse", ok: agHold.result.passed >= fixedHold.result.passed, got: `${agHold.result.passed} against ${fixedHold.result.passed}` },
    { name: "Zero citations outside the library in agentic runs", ok: ag.every((a) => a.result.out_of_corpus.length === 0), got: String(ag.reduce((n, a) => n + a.result.out_of_corpus.length, 0)) },
    { name: "No errored cases in any run", ok: runs.every((x) => x.result.errors === 0), got: String(runs.reduce((n, x) => n + x.result.errors, 0)) },
  ];
  return { ready: true, ok: checks.every((c) => c.ok), checks, sameRetrieval: runs.every((x) => x.result.retrieval === runs[0].result.retrieval) };
}

const labelOf = (r) => `${r.set === "cases" ? "main" : "holdout"}, ${r.mode}${r.mode === "agentic" && r.set === "cases" ? ` run ${r.run}` : ""}`;

function kpiRows(runs) {
  const warnings = [];
  const summaries = runs.map((r) => {
    const { summary, warnings: w } = summarizeResult(r.result, PRICES, labelOf(r));
    warnings.push(...w);
    return { ...summary, mode: r.run > 1 ? `${r.mode}, run ${r.run}` : r.mode, label: labelOf(r) };
  });
  return { summaries, warnings };
}

const cell = { padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)", textAlign: "left", verticalAlign: "top", whiteSpace: "nowrap" };
const wrapCell = { ...cell, whiteSpace: "normal" };

export default function EvalPage() {
  const [opts, setOpts] = useState({ main: true, holdout: true, fixed: true, agentic: true, agenticRuns: 2, vectors: true, parallel: 2 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [runs, setRuns] = useState([]);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);
  const set = (k) => (e) => setOpts({ ...opts, [k]: e.target.type === "checkbox" ? e.target.checked : Number(e.target.value) });

  async function run() {
    setBusy(true); setError(""); setRuns([]); setNotes([]); setProgress(null); setCopied(false); stop.current = false;
    try {
      const [cardsSrc, skillSrc] = await Promise.all([raw("data/cards.js"), raw("data/SKILL-v6.7.md")]);
      const scorer = createScorer({ cardsSrc, skillSrc });
      const sets = {};
      if (opts.main) sets.cases = parseCases(await raw("evals/cases.jsonl"), "cases.jsonl");
      if (opts.holdout) sets.holdout = parseCases(await raw("evals/holdout.jsonl"), "holdout.jsonl");
      const plan = [];
      for (const s of Object.keys(sets)) {
        if (opts.fixed) plan.push({ set: s, mode: "fixed", run: 1 });
        if (opts.agentic) for (let i = 1; i <= (s === "cases" ? opts.agenticRuns : 1); i++) plan.push({ set: s, mode: "agentic", run: i });
      }
      const total = plan.reduce((n, p) => n + sets[p.set].length, 0);
      if (!total) throw new Error("Nothing to run: pick at least one set and one mode.");
      if (!window.confirm(`This runs ${total} checks on this site, and each one spends API credit. Continue?`)) { setBusy(false); return; }

      let done = 0;
      const out = [];
      const vectorNotes = new Set();
      for (const p of plan) {
        const cases = sets[p.set];
        const rows = new Array(cases.length);
        let model = "", vectorSent = false;
        await pool(cases.map((c, i) => async () => {
          if (stop.current) return;
          const r = await checkOne(c, p.mode, scorer, opts.vectors);
          rows[i] = r.scored;
          if (r.model) model = r.model;
          if (r.vectorSent) vectorSent = true;
          if (r.vectorError) vectorNotes.add(r.vectorError);
          done++;
          // Holdout case ids are not shown while it runs, only the count.
          setProgress({ done, total, label: p.set === "cases" ? `${labelOf(p)}: ${c.id}` : labelOf(p) });
        }), opts.parallel);
        if (stop.current) break;
        const s = summarize(rows);
        const retrieval = rows.some((x) => /meaning/.test(x.search || "")) ? "keywords + meaning" : "keyword-only";
        const result = toResult({ base: window.location.origin, set: p.set, mode: p.mode, model, retrieval, vectorSent, s, rows, corpusSize: scorer.corpusSize });
        out.push({ ...p, result });
        setRuns([...out]);
      }
      setNotes([...vectorNotes, ...(stop.current ? ["Stopped before the end: the run that was in progress is not shown."] : [])]);
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  }

  const { summaries, warnings } = kpiRows(runs);
  const verdict = runs.length ? decide(runs) : null;
  const markdown = () => [
    ...kpiTable(summaries), "",
    ...(holdoutTable(summaries).length ? [...holdoutTable(summaries), ""] : []),
    `Runner: /eval in the browser, ${window.location.origin}, commit ${REF}.`,
    ...footnotes(summaries, PRICES, [...warnings, ...notes]),
    ...(verdict?.ready ? ["", `Decision rule: ${verdict.ok ? "PASSED" : "NOT PASSED"}`, ...verdict.checks.map((c) => `- ${c.ok ? "pass" : "FAIL"}: ${c.name} (${c.got})`)] : []),
  ].join("\n");
  const download = () => {
    // Main-set results only: holdout rows carry its expected answers.
    const blob = new Blob([JSON.stringify(runs.filter((r) => r.set === "cases").map((r) => r.result), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crew-check-eval-main-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <main>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Eval runner</div>
          <div className="panel-title">Fixed RAG against agentic search</div>
        </div>
        <div className="panel-body">
          <p className="card-meta" style={{ marginTop: 0 }}>
            Runs the eval cases against this site and scores them with the same rules as <code>evals/run_eval.js</code>.
            It uses this site’s own API key, so every check spends real credit. Agentic runs need <code>AGENTIC_RETRIEVAL=on</code> on
            the deployment. Holdout runs are shown as totals only.
          </p>
          <div className="controls" style={{ flexWrap: "wrap", gap: 16 }}>
            <label><input type="checkbox" checked={opts.main} onChange={set("main")} /> Main set</label>
            <label><input type="checkbox" checked={opts.holdout} onChange={set("holdout")} /> Holdout</label>
            <label><input type="checkbox" checked={opts.fixed} onChange={set("fixed")} /> Fixed RAG</label>
            <label><input type="checkbox" checked={opts.agentic} onChange={set("agentic")} /> Agentic search</label>
            <label>Agentic runs on the main set{" "}
              <select value={opts.agenticRuns} onChange={set("agenticRuns")}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
            <label><input type="checkbox" checked={opts.vectors} onChange={set("vectors")} /> Send meaning vectors (the path users get)</label>
            <label>Checks at a time{" "}
              <select value={opts.parallel} onChange={set("parallel")}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
          </div>
          <div className="controls">
            <button className="btn primary" onClick={run} disabled={busy}>{busy ? "Running..." : "Run comparison"}</button>
            {busy && <button className="btn" onClick={() => { stop.current = true; }}>Stop</button>}
          </div>
          {progress && <div className="stage">{progress.done} of {progress.total} checks · {progress.label}</div>}
        </div>
      </div>

      {error && <div className="panel error"><div className="panel-body">Error: {error}</div></div>}

      {verdict && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Decision rule for agentic search</div>
            <div className="panel-title">{verdict.ready ? (verdict.ok ? "Passed: worth switching on" : "Not passed: keep it off") : "Not enough runs yet"}</div>
          </div>
          <div className="panel-body">
            {!verdict.ready && <div className="empty">{verdict.text}</div>}
            {verdict.ready && verdict.checks.map((c) => (
              <div className="card-meta" key={c.name}>{c.ok ? "Pass" : "Fail"}: {c.name} (got {c.got})</div>
            ))}
            {verdict.ready && !verdict.sameRetrieval && <div className="card-meta">Warning: the runs did not all use the same retrieval, so they are not like for like.</div>}
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">KPIs</div>
            <div className="panel-title">{runs.length} run{runs.length === 1 ? "" : "s"}</div>
          </div>
          <div className="panel-body" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>{["Run", "Retrieval", "Score", "Off-library cites", "Clean false flags", "Errors", "Cost per check", "Cost per passing case", "p50", "p95", "Model calls", "Searches"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.label}>
                    <td style={wrapCell}>{s.label}</td>
                    <td style={wrapCell}>{s.retrieval}</td>
                    <td style={cell}>{s.score.toFixed(1)}% ({s.passed}/{s.total})</td>
                    <td style={cell}>{s.out}</td>
                    <td style={cell}>{s.cleanFp.toFixed(1)}%</td>
                    <td style={cell}>{s.errors}</td>
                    <td style={cell}>{money(s.perCheck)}</td>
                    <td style={cell}>{s.passed ? money(s.perPass) : "none passed"}</td>
                    <td style={cell}>{s.p50 == null ? "n/a" : `${(s.p50 / 1000).toFixed(1)} s`}</td>
                    <td style={cell}>{s.p95 == null ? "n/a" : `${(s.p95 / 1000).toFixed(1)} s`}</td>
                    <td style={cell}>{s.calls == null ? "n/a" : s.calls.toFixed(2)}</td>
                    <td style={cell}>{s.searches == null ? "n/a" : s.searches.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {[...notes, ...footnotes(summaries, PRICES, warnings)].map((n) => <div className="card-meta" key={n}>{n}</div>)}
            <div className="controls">
              <button className="btn" onClick={async () => { await navigator.clipboard.writeText(markdown()); setCopied(true); }}>{copied ? "Copied" : "Copy results as text"}</button>
              <button className="btn" onClick={download}>Download main-set results (JSON)</button>
            </div>
          </div>
        </div>
      )}

      {runs.filter((r) => r.set === "cases").map((r) => (
        <details className="panel" key={labelOf(r)}>
          <summary className="panel-header" style={{ cursor: "pointer" }}>
            <span className="panel-title">Cases: {labelOf(r)}</span>
            <span className="panel-title">{r.result.passed}/{r.result.total} passed</span>
          </summary>
          <div className="panel-body" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>{["Case", "Result", "Expected", "Got", "Why", "Searches"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
              <tbody>
                {r.result.rows.map((x) => (
                  <tr key={x.id}>
                    <td style={cell}>{x.id}</td>
                    <td style={cell}>{x.result}</td>
                    <td style={cell}>{x.expected}</td>
                    <td style={cell}>{x.predicted || ""}</td>
                    <td style={wrapCell}>{(x.why || []).join("; ")}</td>
                    <td style={wrapCell}>{(x.tool_calls || []).map((t) => t.query).filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </main>
  );
}
