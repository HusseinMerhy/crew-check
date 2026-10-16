// Which Claude model the app uses. Set CLAUDE_MODEL in Vercel to switch, no code change needed.
// Only these exact names are accepted, so a typo can't break or overspend.
export const ALLOWED_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function getModel() {
  const raw = (process.env.CLAUDE_MODEL || "").trim();
  if (!raw) return { model: DEFAULT_MODEL, note: "CLAUDE_MODEL not set, using the default." };
  if (ALLOWED_MODELS.includes(raw)) return { model: raw, note: "From CLAUDE_MODEL." };
  return { model: null, note: `CLAUDE_MODEL is "${raw}", which is not valid. Use one of: ${ALLOWED_MODELS.join(", ")}` };
}
