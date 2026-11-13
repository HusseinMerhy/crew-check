// The connection OBI ("The One") can use at its quote audit step: ask Quote Builder for its
// verdict on a work order, or have a quote checked before it is sent. See docs/obi-handoff.md.
// Off until OBI_API_KEY is set in Vercel. OBI sends it as "Authorization: Bearer <key>".
// Nothing here reads from or writes to ClickUp, and no answer carries a dollar amount.
import { createHash, timingSafeEqual } from "node:crypto";
import { crewCheckLine } from "./fieldline.js";
import { verdictOf } from "./clients.js";
import { nteFact, nteText, overtimeOf, overtimeText } from "./quotefacts.js";

const digest = (s) => createHash("sha256").update(String(s)).digest();

// Null when the call may go on, else the refusal to send back.
export function obiRefusal(header, key) {
  if (!key) return { status: 501, body: { ok: false, problem: "The OBI connection is off: OBI_API_KEY is not set in Vercel." } };
  if (!timingSafeEqual(digest(header || ""), digest(`Bearer ${key}`))) return { status: 401, body: { ok: false, problem: "Wrong or missing key." } };
  return null;
}

// The same verdict the OSHA Check field carries, plus the two facts shown in the tool only.
function facts(quote, nte) {
  const ot = overtimeOf(quote);
  return {
    nte: nte ? { state: nte.state, pct: nte.pct, text: nteText(nte) } : null,
    overtime: { billed: ot.billed, reason: ot.reason, text: overtimeText(ot) },
  };
}

// A quote OBI sent and the tool checked just now. The raw quote (with prices) is used for the NTE
// percent and then dropped: none of it is returned.
export function freshResult({ answer, quote, nte }) {
  const line = crewCheckLine(answer, quote);
  return {
    ok: true, line, keyword: verdictOf(line), headline: String(answer || "").split("\n")[0], answer,
    ...facts(quote, nte != null ? nteFact(quote, nte) : null),
  };
}

// A work order the tool checked earlier, from its auto_checks row.
export function storedResult(r) {
  if (!r) return { ok: false, problem: "This work order has not been checked yet." };
  if (!r.ok) return { ok: false, task_id: r.task_id, problem: `The last check failed: ${r.problem || "error"}. It is tried again on the next run.` };
  const line = crewCheckLine(r.answer, r.quote);
  return {
    ok: true, task_id: r.task_id, task_name: r.task_name, status: r.status, checked_at: r.checked_at,
    line, keyword: verdictOf(line), headline: String(r.answer || "").split("\n")[0],
    // False when the quote in ClickUp changed after the check and was not checked again yet.
    current: r.now_hash && r.quote_hash ? r.now_hash === r.quote_hash : null,
    quote_check: r.quote_check ?? null,
    ...facts(r.quote, r.nte_state ? { state: r.nte_state, pct: r.nte_pct } : null),
  };
}
