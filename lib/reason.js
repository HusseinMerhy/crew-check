// Find the missing two-person reason in the tech's own words. When the check says NO REASON, the
// reason is often in the call or the texts with the tech ("the door is 300 lb, I need a hand to
// hold it"), just not in the quote. The person pastes that conversation; the model points at the
// words; code then checks those words really are in what was pasted. A suggestion is never built
// from words that are not there.
// OBI already keeps these calls (Quo transcripts); until it shares them, the paste stands in.
import { stripMoney } from "./money.js";

export const MAX_CONVERSATION = 20000;

export const REASON_SYSTEM = `You read a conversation between a dispatcher and a field technician about one job, and the job's quote.
Find where someone says why the work needs two people at the same time: a heavy or awkward lift, holding something while another person fastens it, a ladder that must be held, a safety watch, or a step one person cannot do alone.
Answer with JSON only, no other text:
{"found": true or false, "words": "the exact words from the conversation that give the reason, copied character for character, at most 200 characters", "step": "one plain sentence for the quote naming the step that needs two people and why"}
Rules:
- Copy "words" exactly from the conversation. Never rephrase them, never take them from the quote.
- If nobody in the conversation says why two people are needed, answer {"found": false, "words": "", "step": ""}.
- Wanting help, saving time, or "it's a big job" is not a reason. Say found false.
- No dollar amounts. No em dashes.`;

export const reasonUser = (quote, conversation) =>
  `Quote:\n${stripMoney(quote).slice(0, 4000)}\n\nConversation:\n${String(conversation).slice(0, MAX_CONVERSATION)}`;

// Lower case, straight quotes, one space: so a copy that differs only in spacing still matches.
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

// The model's answer, parsed loosely ({...} found inside any text), then checked against the
// conversation. Returns { found, words, step, note }.
export function readReason(text, conversation) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  let d = null;
  try { d = m ? JSON.parse(m[0]) : null; } catch { d = null; }
  if (!d) return { found: false, words: "", step: "", note: "The answer could not be read. Try again." };
  if (!d.found) return { found: false, words: "", step: "", note: "No two-person reason in this conversation. Remove Tech 2 or ask the tech why a second person is needed." };
  const words = String(d.words || "").trim().replace(/^["']|["']$/g, "");
  if (norm(words).length < 12 || !norm(conversation).includes(norm(words))) {
    return { found: false, words: "", step: "", note: "The words given are not in the conversation, so nothing is suggested. Read the conversation yourself." };
  }
  const step = stripMoney(String(d.step || "")).replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!step) return { found: false, words, step: "", note: "A reason was found but no step was written. Use the words above." };
  return { found: true, words, step, note: null };
}
