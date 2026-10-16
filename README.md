# OSHA check bot (proof of concept)

Paste a quote, pick the store's state, and the bot says whether a second tech is required by OSHA, justified for safety or practical reasons, or not shown, and which rule cards it used.

Live: https://crew-check-five.vercel.app · Health check: `/api/health`

---

## How a request travels

```
browser (app/page.js)
  quote + state
  + a meaning vector of the quote (all-MiniLM-L6-v2, 384 numbers, built here in the
    browser, not on the server; the first check downloads about 25 MB from a CDN)
  │
  ▼
app/api/check/route.js
  │
  ├─ R: retrieve
  │    always     ─► lib/retrieve.js ─reads─► data/cards.js   keyword hits, top 3
  │    if vector  ─► Neon + pgvector ─► cards table           closest 4, state-filtered
  │    if vector  ─► Neon + pgvector ─► past_quotes table     closest 3 past jobs
  │
  ├─ A: augment   ─► lib/skill.js (the full skill) + the cards + the past jobs
  │                  + the State line, which code decides and the model may not reword
  │
  ├─ G: generate  ─► lib/anthropic.js ─► Claude API ─► the answer
  │
  └─ log          ─► Neon ─► checks table (dollar amounts removed first)
       │
       ▼
browser shows: the answer + "cards used" + similar past jobs (only while the
  passcode is set) + which search ran + the model + tokens in and out
```

RAG = **R**etrieve (find the right rule cards) + **A**ugment (add them to the prompt) + **G**enerate (the model answers from them).

## The two searches

Keyword search **always** runs. It needs nothing but the code and `data/cards.js`.

Meaning search runs **only when both** of these are true:

1. the browser managed to build a vector for the quote (the model downloads from a CDN on first use), and
2. `DATABASE_URL` is set, so there is a database to search.

If either is missing, the app still answers from keyword search alone and the line under the answer reads `Search: keywords only`. A database error during the search reads `Search: keywords only (database error)`. When both searches ran it reads `Search: keywords + meaning`.

## The files

| File | Role |
|---|---|
| `data/cards.js` | **The library.** One rule per card (condition + consequence together), each labeled: state, layer, citation, keywords, source, date checked. Also `PLAN_STATES`: the 22 states with their own OSHA plan, each marked with how much of that state's own rules are loaded as cards: `none`, `partial` or `complete`. Today California is `partial` and the other 21 are `none`. The check route words the prompt differently for `none` ("cards are not loaded yet, use the state-plan State line") and for `partial` ("cite the state card when one covers the topic"). |
| `lib/retrieve.js` | **Retrieve, keyword half.** `findCards`: filter to federal + the store's state, score cards by whole-word keyword hits, return the top 3. The match patterns are built once when the module loads, not per request. `stateStatus`: no plan / plan state / not given. |
| `lib/skill.js` | **The instructions** (skill v6.7). Always sent in full, so the 5 federal rules are never missed even if the search misses. Generated from `data/SKILL-v6.7.md`. |
| `app/api/check/route.js` | **Augment + Generate.** Safety checks, runs both searches, builds the system message (skill + `<retrieved_cards>` + `<similar_past_jobs>`) and the user message (quote + state + the State line), calls Claude, enforces the State line, logs the check, returns answer + cards + usage. The API key is only read here, on the server. |
| `lib/anthropic.js` | **One place where the app talks to Claude.** Used by both `/api/check` and `/api/health`, so the headers and the error shapes cannot drift apart. Has a timeout and never throws: it returns either the data or a named problem (`timeout`, `network`, or the API's own error type). |
| `lib/db.js` | Connects to the Neon database (`DATABASE_URL`, added by Vercel → Storage). Turns a vector into the text pgvector expects, checks a vector is really 384 finite numbers, and removes dollar amounts before anything is stored. |
| `app/api/admin/route.js` | Created the tables and loaded the cards and 9,490 stripped past quotes. **Locked:** `ADMIN_HASH` is `""`, so every request is refused, whatever token is sent. To load data again, put a new SHA-256 fingerprint of a fresh token in `ADMIN_HASH` and redeploy. The token itself is never in the code. |
| `lib/model.js` | Reads `CLAUDE_MODEL`; only accepts `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. |
| `app/page.js` | The screen (runs in the browser). Builds the meaning vector, sends the quote to `/api/check`, shows the answer, the cards used and the similar past jobs. |
| `app/api/health/route.js` | One tiny Claude call to prove the key and model work. |
| `middleware.js` | The lock. If `SITE_PASSCODE` is set, every page and every `/api/*` route asks for it. If not set, the site is open. The compare is constant-time over SHA-256 digests, so the response time does not leak how much of a guess was right. |
| `tests/run.mjs` | The 16-case test. Scores headline type, OSHA field, State line, no dollars, no em dashes. The test quotes are real customer text and are kept out of GitHub (`tests/inputs.md` is in `.gitignore`). |

## The database (Neon Postgres, pgvector)

| Table | Rows | What it holds |
|---|---|---|
| `cards` | 16 | The same rule cards as `data/cards.js`, plus a 384-number embedding so they can be found by meaning. 10 federal, 6 California. |
| `past_quotes` | 9,490 | Past invoiced quotes that billed a second tech, with prices and names removed, plus an embedding. Context only: never a reason by itself, never an OSHA citation. |
| `checks` | grows | A log of every check: state, quote (dollar amounts removed), model, the cards and past jobs used, the answer, tokens in and out. |

Similar past jobs are internal data, so they are only shown on screen while `SITE_PASSCODE` is set. On an open site they are still used in the prompt, and the screen says they were used but are hidden.

## Settings (Vercel → Settings → Environment Variables)

See `.env.example` for the same list with notes and no values.

| Key | Type | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | Pays for the AI. Required. Never share it or put it in code. |
| `CLAUDE_MODEL` | Config | Which model answers. Unset means `claude-haiku-5-5`. |
| `SITE_PASSCODE` | Secret | The lock. Keep it on whenever the site is not being demoed: unset means anyone who finds the URL can spend your API credit. |
| `DATABASE_URL` | Secret | The Neon connection string, added by Vercel when the database is attached. Without it the app still answers, but keyword-only, with no past jobs and no log. |

After changing any setting: Deployments → **top row** → Redeploy. Never redeploy an older row (it puts old code live).

## Running the tests

```
node tests/run.mjs https://crew-check-five.vercel.app   # the live site (also `npm test`)
node tests/run.mjs http://localhost:3000                # a local `npm run dev`
CREW_CHECK_PASSCODE=... node tests/run.mjs https://crew-check-five.vercel.app   # locked site
```

The lock covers `/api/*` as well as the pages, so against a locked site set `CREW_CHECK_PASSCODE` to the same value as `SITE_PASSCODE` or every case comes back 401.

`tests/inputs.md` holds the 16 quotes and is **not in git**: they are real customer text. A fresh clone therefore cannot run the suite, and the script says so and stops rather than failing with a confusing file error. Each run also spends real API credit, 16 questions' worth.

That is why continuous integration (`.github/workflows/ci.yml`) does not run the suite. It runs `npm ci` and `npm run build`, which proves the code compiles and every route and the middleware bundle. Answer quality is checked by hand against a deployment.

## Test results (Oct 16, 2026, Haiku)

| Test | Result |
|---|---|
| Search: right card in the results | 11/11 (100%) |
| Search: card from the wrong state | 0 |
| Answers: 16 cases | 15/16, 0 false "OSHA requires" |

## Known limits

- **Keyword matching is literal.** `findCards` matches whole words plus simple endings, so a quote that says the same thing in other words scores zero. Meaning search covers part of this gap, but only when the browser model loaded and the database is reachable.
- **Few state cards.** Only California has state cards, and only for some topics (confined spaces, high voltage, welding, roofing, ladders). Every other plan state gets "check state rules before citing" and no state rule text. The fire watch duration for California is in NFPA 51B (not public text) and is not verified.
- **Past jobs have no relevance floor.** A card found only by meaning must score at least 0.25 to be sent to the model; the 3 closest past jobs are sent whatever they score, so on an unusual quote they can be noise. They are labelled context-only in the prompt, so the cost is a distraction rather than a wrong citation. Worth revisiting once a test exists that can show what a floor does to the answers.
- **The default model is Haiku, but the skill was scored on Opus.** Set `CLAUDE_MODEL` to run a bigger model, and put any model through the 16 cases before trusting it on real quotes.
- **Meaning search depends on a CDN.** The browser downloads about 25 MB (the embedding model) from jsdelivr on first use. If that is blocked or fails, the app quietly falls back to keyword-only and the screen says `Search: keywords only`. A failed download is not cached, so the next Check tries again.
- When both a safety reason and a two-hands step apply, the skill does not say which headline wins (test case 3).

## Learn it by changing it (do these in order)

1. **Retrieval:** add `"hatch"` to the keywords of card `fed-1910-146` in `data/cards.js`. Test "tech climbed through the hatch into the tank". Does the card appear under "Cards used"?
2. **Top-k:** in `lib/retrieve.js` change `k = 3` to `k = 1`. Test "torched the bracket, cardboard nearby, inside the tank". What card disappears? Change it back.
3. **Augment:** in `app/api/check/route.js`, find `<retrieved_cards>`. Read the sentence telling the model a card being retrieved does not mean it applies. Why is it there? (Hint: the 120 V work light and the 600 V card.)
4. **The library:** write one real state card in `data/cards.js`. Find the rule on the state's official site, copy the shape of a federal card, set `state`, citation, source and date. Have it reviewed before committing: a wrong card is a wrong citation.
5. **One search instead of two:** block the browser model and watch what the keyword half can do alone. In the browser's dev tools, Network tab, block the request to `cdn.jsdelivr.net`, then run a check. The line under the answer should read `Search: keywords only`. Run the same quote with the block off and compare "Cards used": which cards did meaning search add, and would the answer have cited a different rule without them?
