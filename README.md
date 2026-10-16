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

## Known limits (v1)

- Search matches words, not meaning: "torch" finds welding only because both words are listed on the card. Upgrade: embeddings.
- No state rule cards yet: plan states get "check state rules before citing".
- No saved logs: every answer disappears after you read it. Upgrade: database (Supabase).
- The skill was scored 16/16 on Opus in testing; smaller models must pass the same test before use.

## Learn it by changing it (do these in order)

1. **Retrieval:** add `"hatch"` to the keywords of card `fed-1910-146`. Test "tech climbed through the hatch into the tank". Does the card appear under "Cards used"?
2. **Top-k:** in `lib/retrieve.js` change `k = 3` to `k = 1`. Test "torched the bracket, cardboard nearby, inside the tank". What card disappears? Change it back.
3. **Augment:** in `app/api/check/route.js`, find `<retrieved_cards>`. Read the sentence telling the model a card being retrieved does not mean it applies. Why is it there? (Hint: the 120 V work light and the 600 V card.)
4. **The library:** write one real state card. Find the rule on the state's official site, copy the shape of a federal card, set `state`, citation, source and date. Have it reviewed before committing: a wrong card is a wrong citation.
5. **Test:** run `node tests/run.mjs` and read which cases fail and why.
