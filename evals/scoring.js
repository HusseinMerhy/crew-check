// The eval's scoring rules in one place, shared by both runners: evals/run_eval.js (Node) and
// the /eval page (app/eval/page.js, in a browser on the deployed site). One ruler, two ways to
// hold it, so a score from one can be compared with a score from the other.
//
// Pure functions only: no file reads, no network. data/cards.js and data/SKILL-v6.7.md come in
// as source text, read by the caller, and are parsed here the same way for both runners.
//
// See CLAUDE.md for the definition of "indexed corpus", the deny list, and the pass/flag
// mapping. The mapping is an interpretation, not a specification.

// ----------------------------------------------------------------- citations
// A citation is "in the indexed corpus" if it appears anywhere in data/cards.js
// (citation field or card text) or anywhere in data/SKILL-v6.7.md. Both files
// are parsed with the same extractor used on the model's answer, so the set
// cannot rot when a card or a skill version changes.

// Deliberately generous: a missed citation is a missed hallucination.
export const CITE_PATTERNS = [
  // OSH Act general duty clause
  /OSH\s*Act[\s,]*(?:§+|Sections?|Secs?\.?)?\s*5\s*\(\s*a\s*\)\s*\(\s*1\s*\)/gi,
  // federal CFR: 29 CFR 1910.146, 1926.502(h)(1), §1910.269(l)(2)(i)
  /(?:29\s*C\.?\s*F\.?\s*R\.?\s*)?(?:§+\s*)?\b19\d{2}\.\d+(?:\([^()\s]{1,8}\))*/g,
  // California title 8: Cal. Code Regs. tit. 8, §5157(d)(6) / §3276(e)(14)
  /(?:Cal\.?\s*Code\s*Regs\.?[^§\n]{0,40})?§+\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/g,
  /\b8\s*C\.?\s*C\.?\s*R\.?\s*§*\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/gi,
  /\btitle\s*8[\s,]*(?:sections?|secs?\.?|§+)\s*\d{3,4}(?:\.\d+)?(?:\([^()\s]{1,8}\))*/gi,
  // standards bodies named in the skill
  /\bNFPA\s*\d+[A-Z]?\b/gi,
  /\bANSI\s*Z\s*[\d.-]+/gi,
];

export function normCite(raw) {
  let s = String(raw).replace(/ /g, " ").trim();
  s = s.replace(/^29\s*C\.?\s*F\.?\s*R\.?\s*/i, "");
  s = s.replace(/^Cal\.?\s*Code\s*Regs\.?\s*,?\s*/i, "");
  s = s.replace(/^tit(?:le)?\.?\s*8\s*,?\s*/i, "");
  s = s.replace(/^8\s*C\.?\s*C\.?\s*R\.?\s*/i, "");
  s = s.replace(/\b(?:sections?|secs?\.)\s*/gi, ""); // "OSH Act Section 5(a)(1)" == "OSH Act 5(a)(1)"
  s = s.replace(/§/g, "").replace(/,/g, "").replace(/\s+/g, "").replace(/[.,;:]+$/, "");
  return s.toLowerCase();
}

export function extractCitations(text) {
  const out = new Map(); // key -> raw as first seen
  for (const re of CITE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of String(text || "").matchAll(re)) {
      const raw = m[0].trim();
      const key = normCite(raw);
      if (!key || /^\d{1,2}$/.test(key)) continue;
      if (!out.has(key)) out.set(key, raw);
    }
  }
  return [...out].map(([key, raw]) => ({ key, raw }));
}

const baseOf = (key) => { const i = key.indexOf("("); return i < 0 ? key : key.slice(0, i); };

// Present in the prompt, so they pass the corpus test, but must never be output.
// 1910.23(c)(7) is NOT denied: it is a real card and a real Layer 2 row.
export const DENY = ["1910.269(l)(1)(i)", "1910.333", "nfpa70e"];
export const isDenied = (key) => DENY.some((d) => key === d || key.startsWith(d + "(") || baseOf(key) === d);

// ------------------------------------------------------- answer field readers
// headType and oshaField are from tests/run.mjs.
export function headType(first) {
  if (/^OSHA requires/i.test(first)) return "requires";
  if (/^OSHA may require/i.test(first)) return "may";
  if (/makes sense here for safety/i.test(first)) return "safety";
  if (/two pairs of hands/i.test(first)) return "hands";
  if (/is backed by/i.test(first)) return "backed";
  if (/doesn.t show a reason/i.test(first)) return "none";
  if (/one person on site/i.test(first)) return "alone";
  return "other";
}
function summaryLine(ans) {
  return ans.split("\n").find((l) => l.trim().startsWith("OSHA:")) || "";
}
export function oshaField(ans) {
  const f = summaryLine(ans).split("|")[0];
  if (/OSHA:\s*Yes/i.test(f)) return "yes";
  if (/Need/i.test(f)) return "need";
  if (/OSHA:\s*No/i.test(f)) return "no";
  return "missing";
}
export function safetyField(ans) {
  const f = summaryLine(ans).split("|")[1] || "";
  if (/Safety:\s*Yes/i.test(f)) return "yes";
  if (/Need/i.test(f)) return "need";
  if (/Safety:\s*No/i.test(f)) return "no";
  return "missing";
}
export function twoPersonField(ans) {
  const f = summaryLine(ans).split("|")[2] || "";
  if (/Yes/i.test(f)) return "yes";
  if (/No/i.test(f)) return "no";
  return "missing";
}
// Tech 2 hours as billed in the quote, e.g. "Tech 2 - 3 hrs"
export function tech2Hours(quote) {
  const m = String(quote).match(/tech\s*2[^0-9\n]{0,24}?(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour)/i);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------- pass / flag mapping
// This is an interpretation of the owner's principle, not his specification.
// See CLAUDE.md. Change it here and there if it is wrong: both runners use this one.
export function mapVerdict({ head, osha, safety, t2 }) {
  const why = [];
  if (head === "requires" || head === "may" || head === "safety") why.push(`headline ${head}`);
  if (osha === "yes" || osha === "need") why.push(`OSHA ${osha}`);
  if (safety === "yes") why.push("Safety yes");
  if (head === "none" && t2 != null) why.push(`no reason shown but Tech 2 billed ${t2} h`);
  return { verdict: why.length ? "flag" : "pass", why };
}

// The two letter state is carried in the quote's "Store state:" line.
export function stateOf(quote) {
  const m = String(quote).match(/store\s*state\s*:\s*([A-Za-z]{2})\b/i);
  return m ? m[1].toUpperCase() : "";
}

// One line of a .jsonl case file per case. A bad line throws, naming it.
export function parseCases(text, label) {
  return String(text).split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`Line ${i + 1} of ${label} is not JSON: ${e.message}`); }
  });
}

// ------------------------------------------------ the parts built from the data
// cardsSrc is the text of data/cards.js, skillSrc the text of data/SKILL-v6.7.md.
export function createScorer({ cardsSrc, skillSrc }) {
  const CORPUS = new Set(extractCitations(cardsSrc + "\n" + skillSrc).map((c) => c.key));
  const CORPUS_BASES = new Set([...CORPUS].map(baseOf));

  function classifyCitation(key) {
    if (CORPUS.has(key)) return "IN";
    for (const c of CORPUS) if (c.startsWith(key + "(")) return "IN"; // broader cite of a corpus rule
    if (CORPUS_BASES.has(baseOf(key))) return "DEEPER";
    return "OUT";
  }

  // state -> its `standards` value ("federal", "own", "mixed"), because the State line the route
  // writes for a plan state depends on it. A plan state with no standards value maps to null.
  const planBlock = cardsSrc.match(/export\s+const\s+PLAN_STATES\s*=\s*\{([\s\S]*?)\n\}/);
  const PLAN = new Map(planBlock
    ? [...planBlock[1].matchAll(/\b([A-Z]{2})\s*:\s*\{([^}]*)\}/g)].map((m) => [m[1], (m[2].match(/standards:\s*"(\w+)"/) || [])[1] || null])
    : []);
  if (PLAN.size === 0) throw new Error("Could not read PLAN_STATES from data/cards.js, so the State line cannot be scored.");

  // adapted from stateOk in tests/run.mjs. One branch per State line form in app/api/check/route.js:
  // a plan state that enforces the federal standards gets a different line from one with its own rules.
  function stateLineOk(ans, st) {
    const line = ans.split("\n").find((l) => l.trim().startsWith("State:")) || "";
    if (!line) return false;
    if (!st) return /not given/i.test(line);
    if (!PLAN.has(st)) return /follows federal/i.test(line);
    if (PLAN.get(st) === "federal") return /runs its own OSHA plan but enforces the federal standards/i.test(line);
    return /has its own OSHA rules/i.test(line);
  }

  // One /api/check reply, already parsed, to the case's row. `row` carries id, state, expected and
  // expected_issue_type plus what the runner measured (http, latency_ms); `mode` is the mode the
  // runner asked for. A reply that never arrived, or was not JSON, stays with the runner.
  function scoreReply(c, d, row, mode) {
    if (!d || d.ok !== true) {
      return { ...row, result: "ERROR", why: [`api: ${d?.problem || "unknown"} ${String(d?.detail || "").slice(0, 100)}`.trim()] };
    }
    if (mode === "agentic" && d.mode !== "agentic") {
      return { ...row, result: "ERROR", why: ["server answered with the fixed pipeline: set AGENTIC_RETRIEVAL=on there"] };
    }

    // All four usage fields: input_tokens counts only the uncached part, so a cost computed
    // without the cache fields is wrong whenever the skill prefix is cached.
    const usage = {
      input_tokens: d.usage?.input_tokens || 0,
      output_tokens: d.usage?.output_tokens || 0,
      cache_read_input_tokens: d.usage?.cache_read_input_tokens || 0,
      cache_creation_input_tokens: d.usage?.cache_creation_input_tokens || 0,
    };

    const ans = d.answer || "";
    const first = (ans.split("\n")[0] || "").trim();
    const head = headType(first);
    const osha = oshaField(ans);
    const safety = safetyField(ans);
    const twoP = twoPersonField(ans);
    const t2 = tech2Hours(c.quote_text);
    const { verdict, why: mapWhy } = mapVerdict({ head, osha, safety, t2 });

    const cites = extractCitations(ans).map((x) => ({ ...x, bucket: classifyCitation(x.key), denied: isDenied(x.key) }));
    const out = cites.filter((x) => x.bucket === "OUT");
    const deeper = cites.filter((x) => x.bucket === "DEEPER");
    const denied = cites.filter((x) => x.denied);

    const why = [];
    if (verdict !== c.expected_verdict) why.push(`verdict ${verdict}, expected ${c.expected_verdict}`);
    for (const x of out) why.push(`citation not in corpus: ${x.raw}`);
    for (const x of denied) why.push(`deny list citation: ${x.raw}`);
    if (/\$\s?\d/.test(ans)) why.push("dollar amount in answer");
    if (/\u2014/.test(ans)) why.push("em dash in answer");
    if (head !== "alone" && !stateLineOk(ans, row.state)) why.push("State line wrong or missing");

    const ok = why.length === 0;
    const wantCite = (c.expected_citation || "").replace(/\s*\[UNVERIFIED\]\s*$/i, "").trim();
    const citeSeen = wantCite ? cites.some((x) => x.key === normCite(wantCite)) : null;

    return {
      ...row, result: ok ? "PASS" : "FAIL", why, predicted: verdict, mapping_reason: mapWhy,
      head, osha, safety, two_person: twoP, tech2_hours: t2, state_line_ok: stateLineOk(ans, row.state),
      expected_citation: c.expected_citation || null, expected_citation_seen: citeSeen,
      citations: cites, out_of_corpus: out.map((x) => x.raw), deeper_than_corpus: deeper.map((x) => x.raw),
      deny_hits: denied.map((x) => x.raw), search: d.search, usage, headline: first, answer: ans,
      // The fixed pipeline makes one call per check; a deployment older than the mode field reports none.
      model_calls: d.model_calls ?? 1, tool_calls: d.tool_calls || [], agentic_fallback: d.agentic_fallback ?? null,
    };
  }

  return { corpusSize: CORPUS.size, plan: PLAN, classifyCitation, stateLineOk, scoreReply };
}

// ------------------------------------------------------------------- summary
export function summarize(rows) {
  const scored = rows.filter((r) => r.result !== "ERROR");
  const errors = rows.filter((r) => r.result === "ERROR");
  const passed = scored.filter((r) => r.result === "PASS").length;
  const score = rows.length ? (passed / rows.length) * 100 : 0; // errors count against the score

  const fps = scored.filter((r) => r.expected === "pass" && r.predicted === "flag");
  const fns = scored.filter((r) => r.expected === "flag" && r.predicted === "pass");

  const cleanAll = rows.filter((r) => /(^|-)clean-/.test(r.id) || r.id.startsWith("clean-"));
  const cleanScored = cleanAll.filter((r) => r.result !== "ERROR");
  const cleanFp = cleanScored.filter((r) => r.predicted === "flag");
  const cleanFpRate = cleanScored.length ? (cleanFp.length / cleanScored.length) * 100 : 0;

  const allOut = scored.flatMap((r) => r.out_of_corpus.map((c) => ({ id: r.id, c })));
  const allDeeper = scored.flatMap((r) => r.deeper_than_corpus.map((c) => ({ id: r.id, c })));
  const allDeny = scored.flatMap((r) => r.deny_hits.map((c) => ({ id: r.id, c })));

  const tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  for (const r of scored) {
    tokens.in += r.usage.input_tokens;
    tokens.out += r.usage.output_tokens;
    tokens.cacheRead += r.usage.cache_read_input_tokens;
    tokens.cacheWrite += r.usage.cache_creation_input_tokens;
  }
  return { scored, errors, passed, score, fps, fns, cleanScored, cleanFp, cleanFpRate, allOut, allDeeper, allDeny, tokens };
}

// The criteria one run can judge on its own. The holdout gap needs a second run, so the caller adds it.
export function criteriaFor(s) {
  return [
    { name: "score at least 90%", ok: s.score >= 90, got: `${s.score.toFixed(1)}%` },
    { name: "zero citations not in the indexed corpus", ok: s.allOut.length === 0, got: String(s.allOut.length) },
    { name: "zero deny list citations", ok: s.allDeny.length === 0, got: String(s.allDeny.length) },
    { name: "false positive rate on clean quotes at most 10%", ok: s.cleanFpRate <= 10, got: `${s.cleanFpRate.toFixed(1)}%` },
    { name: "no errored cases", ok: s.errors.length === 0, got: String(s.errors.length) },
  ];
}

// The result file's shape, the same from both runners, so evals/kpi.js reads either.
export function toResult({ base, set, mode, model, retrieval, vectorSent, s, rows, corpusSize }) {
  return {
    base, set, mode, model: model || null, retrieval, vector_sent: vectorSent,
    ran_at: new Date().toISOString(),
    score: s.score, passed: s.passed, total: rows.length, errors: s.errors.length,
    false_positives: s.fps.map((r) => r.id), false_negatives: s.fns.map((r) => r.id),
    clean_subset: { total: s.cleanScored.length, false_positives: s.cleanFp.map((r) => r.id), rate: s.cleanFpRate },
    out_of_corpus: s.allOut, deny_hits: s.allDeny, deeper_than_corpus: s.allDeeper,
    tokens_in: s.tokens.in, tokens_out: s.tokens.out, cache_read_tokens: s.tokens.cacheRead, cache_write_tokens: s.tokens.cacheWrite,
    deny_list: DENY, corpus_size: corpusSize,
    rows,
  };
}
