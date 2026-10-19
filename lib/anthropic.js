// One place where the app talks to the Claude API.
// Both /api/check and /api/health used to hand-build the same fetch, so the headers and the
// error shapes could drift apart. They also had no timeout: a slow upstream held the
// serverless function open until the platform killed it, and the caller got nothing useful back.
// This module never throws. It always answers { ok: true, data } or { ok: false, status, problem, detail },
// so a route can report the trouble instead of crashing.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export async function callClaude({ key, model, system, user, maxTokens, timeoutMs = 60000 }) {
  // No temperature field on purpose: the 5-series models reject it. Do not add one.
  const payload = { model, max_tokens: maxTokens, messages: [{ role: "user", content: user }] };
  if (system) payload.system = system;

  let r;
  try {
    r = await fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout is worth naming: "network" sends someone hunting the wrong problem.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 502, problem: "timeout", detail: `No answer from the Claude API within ${Math.round(timeoutMs / 1000)} seconds.` };
    }
    return { ok: false, status: 502, problem: "network", detail: String(e).slice(0, 200) };
  }

  // An error response is not always JSON (a gateway page, an empty body), so parse defensively.
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, status: r.status, problem: data?.error?.type || "unknown", detail: data?.error?.message || "" };
  }
  return { ok: true, data };
}

// The text the model wrote, with the non-text parts dropped.
// Returns "" when the model wrote nothing, which the check route reports as empty_answer.
export function textOf(data) {
  return (data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}
