// Meaning search, step 1: turn the quote into a meaning vector IN THE BROWSER, with the same free model
// used to place the cards and past quotes (all-MiniLM-L6-v2, 384 numbers). First use downloads it (~25 MB).
// Shared by the check page (app/page.js) and the eval runner page (app/eval/page.js), so the eval sends
// exactly the vector a user's browser would.
let embedderPromise = null;
export async function embedQuote(text) {
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
