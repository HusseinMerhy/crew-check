// Vol 2: the per-entity crew history for the check page's history panel.
// The numbers are company data and the repository is public, so they live in Vercel as
// ENTITY_HISTORY (built by scripts/client-profile.mjs --json), not in git. The site passcode in
// middleware.js covers this route like every other.
export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.ENTITY_HISTORY;
  if (!raw) return Response.json({ ok: false, problem: "No history loaded: ENTITY_HISTORY is not set in Vercel." });
  try {
    const history = JSON.parse(raw);
    return Response.json({ ok: true, history });
  } catch {
    return Response.json({ ok: false, problem: "ENTITY_HISTORY in Vercel is not valid JSON." });
  }
}
