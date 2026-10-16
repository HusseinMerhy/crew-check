# OSHA check bot (proof of concept)

Paste a quote, pick the store's state, and the bot says whether a second tech is required by OSHA, justified for safety or practical reasons, or not shown, and which rule cards it used.

Live: https://crew-check-five.vercel.app · Health check: `/api/health`

---

## How a request travels

```
page.js ──(quote + state)──► app/api/check/route.js
                                   │
                                   ├─► lib/retrieve.js ──reads──► data/cards.js   R: find the top 3 cards
                                   ├─► lib/skill.js + cards + quote              A: build one message
                                   ├─► lib/model.js → Claude API                 G: get the answer
                                   ▼
page.js shows: answer + "cards used" + model + tokens
```

RAG = **R**etrieve (find the right rule cards) + **A**ugment (add them to the prompt) + **G**enerate (the model answers from them).

## The files

| File | Role |
|---|---|
| `data/cards.js` | **The library.** One rule per card (condition + consequence together), each labeled: state, layer, citation, keywords, source, date checked. Also `PLAN_STATES`: the 22 state plans and whether their cards are loaded (`complete`). |
| `lib/retrieve.js` | **Retrieve.** `findCards`: filter to federal + the store's state, score cards by whole-word keyword hits, return the top 3. `stateStatus`: no plan / plan state / not given. |
| `lib/skill.js` | **The instructions** (skill v6.7). Always sent in full, so the 5 federal rules are never missed even if the search misses. Generated from `data/SKILL-v6.7.md`. |
| `app/api/check/route.js` | **Augment + Generate.** Safety checks, calls retrieve, builds the system message (skill + `<retrieved_cards>`) and the user message (quote + state), calls Claude, returns answer + cards + usage. The API key is only read here, on the server. |
| `lib/db.js` | Connects to the Neon database (`DATABASE_URL`, added by Vercel → Storage). Removes dollar amounts before anything is stored. |
| `app/api/admin/route.js` | Created the tables and loaded the cards and 9,490 stripped past quotes. **Locked** after loading (`ADMIN_HASH = ""`). |
| `lib/model.js` | Reads `CLAUDE_MODEL`; only accepts `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. |
| `app/page.js` | The screen (runs in the browser). Sends the quote to `/api/check`, shows the answer and the cards used. |
| `app/api/health/route.js` | One tiny Claude call to prove the key and model work. |
| `middleware.js` | The lock. If `SITE_PASSCODE` is set, every page asks for it. If not set, the site is open. |
| `tests/run.mjs` | The 16-case test. Scores headline type, OSHA field, State line, no dollars, no em dashes. Test quotes are kept out of GitHub (`.gitignore`). |

## Settings (Vercel → Settings → Environment Variables)

| Key | Type | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | Pays for the AI. Never share it or put it in code. |
| `CLAUDE_MODEL` | Config | Which model answers. |
| `SITE_PASSCODE` | Secret | The lock. Keep it on whenever the site is not being demoed. |

After changing any setting: Deployments → **top row** → Redeploy. Never redeploy an older row (it puts old code live).

## How the full version searches (v2)

1. **In the browser:** the page turns the quote into a meaning vector with a free open model (all-MiniLM-L6-v2, 384 numbers). The first check downloads it (about 25 MB).
2. **On the server:** cards are found two ways and merged: keywords (`lib/retrieve.js`) and meaning (Neon, pgvector, filtered to federal + the store's state). Up to 4 cards.
3. **Similar past jobs:** the 3 closest of 9,490 past Tech 2 quotes (prices and names removed). Context only, never a reason. Shown on screen only when `SITE_PASSCODE` is on.
4. **State line:** decided by code from the state list, never by the model.
5. **Log:** every check is saved in the `checks` table (dollar amounts removed).

Data: `cards` (16: 10 federal, 6 California), `past_quotes` (9,490), `checks` (log). California is **partial**: confined spaces, high voltage, welding (fire watch details are in NFPA 51B, not verified), roofing, ladders.

## Test results (Oct 16, 2026, Haiku)

| Test | Result |
|---|---|
| Search: right card in the results | 11/11 (100%) |
| Search: card from the wrong state | 0 |
| Answers: 16 cases | 15/16, 0 false "OSHA requires" |

## Known limits

- Only California has state cards, and only for some topics. Every other plan state says "check state rules before citing".
- The fire watch duration for California is in NFPA 51B (not public text) and is not verified.
- When both a safety reason and a two-hands step apply, the skill does not say which headline wins (test case 3).

## Learn it by changing it (do these in order)

1. **Retrieval:** add `"hatch"` to the keywords of card `fed-1910-146`. Test "tech climbed through the hatch into the tank". Does the card appear under "Cards used"?
2. **Top-k:** in `lib/retrieve.js` change `k = 3` to `k = 1`. Test "torched the bracket, cardboard nearby, inside the tank". What card disappears? Change it back.
3. **Augment:** in `app/api/check/route.js`, find `<retrieved_cards>`. Read the sentence telling the model a card being retrieved does not mean it applies. Why is it there? (Hint: the 120 V work light and the 600 V card.)
4. **The library:** write one real state card. Find the rule on the state's official site, copy the shape of a federal card, set `state`, citation, source and date. Have it reviewed before committing: a wrong card is a wrong citation.
5. **Test:** run `node tests/run.mjs` and read which cases fail and why.
