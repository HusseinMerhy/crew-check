# CLAUDE.md

Rules for working on crew-check. Read this before changing anything.

## The owner's rules

These are Hussein's rules. They are not negotiable and not mine to reinterpret.

### Success criteria

A round is finished only when all four of these hold:

- Eval score is at least 90 percent.
- Zero citations that are not in the indexed corpus.
- False positive rate on clean quotes is at most 10 percent.
- Holdout score is within 10 points of the main score.

### How to improve

- One change per round. A round changes exactly one of: the prompt, the chunking, top-k, or the corpus. Never two at once.
- Maximum 5 rounds per session.
- Keep the best-scoring version. Revert regressions.

### What is off limits

- Never edit expected answers in `evals/`.
- Never read `evals/holdout.jsonl` while improving. It is read by the runner, not by you.
- Never touch ClickUp. It is read-only, and nothing here writes to it.
- Keys live in environment variables only. Never in a file, never in a commit.

### How to report

- Say "done" only if every criterion passed. Otherwise list what failed.
- No em dashes in any output text.

## Operating notes (Claude's, not the owner's)

Everything below this line is my implementation record, not Hussein's instruction.
It exists so a future round does not have to rediscover it. Correct it if it is wrong.

### Running the eval

```
node evals/run_eval.js                                  # 25 cases, default BASE
node evals/run_eval.js https://crew-check-five.vercel.app
node evals/run_eval.js https://crew-check-five.vercel.app --holdout
node evals/run_eval.js http://localhost:3000 --agentic  # agentic retrieval experiment, see below
```

No npm script, by design: `package.json` is not modified by this work.
No dependencies: Node builtins only (`fetch`, `fs`, `path`). The file is ES module
syntax in a `.js` file, so it needs a Node that detects that on its own. It has been
run on Node 22.22. A Node 20 release without that detection stops with "Cannot use
import statement outside a module".

If the site is locked, set `CREW_CHECK_PASSCODE` and the runner sends
`Authorization: Basic base64("check:<passcode>")`. Without it a locked site
returns 401 for every case and every case is marked ERROR.

Node's built in `fetch` ignores `HTTPS_PROXY`. Behind a proxy, run with
`NODE_USE_ENV_PROXY=1` (node 22.21 or newer).

Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr because the file
is ESM `.js` and `package.json` has no `"type": "module"`. It is harmless. Do
not silence it by editing `package.json`, and do not rename the file: the
documented command is `node evals/run_eval.js`.

Result files land at `evals/result-<model>-<cases|holdout>.json` and are
gitignored. The holdout criterion is only evaluated when the sibling result
file for the same model is already on disk, so run the main set first.

### Cost, latency and the KPI table

Each result row records `latency_ms` (as the runner sees it, network to the
deployment included) and `usage` with all four token fields. `input_tokens` is
only the uncached part of the prompt, so a cost without the two cache fields is
wrong whenever the skill prefix is cached.

```
node evals/compare.js                 # every evals/result-*.json
node evals/compare.js a.json b.json   # only these
```

It prints one row per result file: the criteria, cost per check, cost per
passing case, p50 and p95 latency, and model calls per check, plus the holdout
gap for each model. Prices live in `evals/prices.json` with the page and the date
they were read. Re-read the page before quoting a cost.

`compare.js` prints holdout result files as totals only. Do not open
`evals/result-*-holdout.json` while improving: it carries the holdout's expected
answers, so reading it is reading the holdout.

### Comparing models

The runner cannot choose the model: the deployment does, from `CLAUDE_MODEL`. To
compare models without touching production, run the app locally once per model
and point the runner at it:

```
CLAUDE_MODEL=claude-sonnet-5-5 npm run dev            # ANTHROPIC_API_KEY set in the environment
node evals/run_eval.js http://localhost:3000
```

Without `DATABASE_URL` the local app is keyword-only and logs nothing, which is
the path the runner tests anyway. Runs against the live site are written to the
`checks` log like any other check, so a cost baseline pulled from that table
includes them.

### The agentic retrieval experiment

`--agentic` asks the server for mode `agentic` (`lib/agentic.js`, Option C in the
comparison report). The fixed search still runs first; on top of it the model may
call one read-only tool, `search_cards`, up to 4 times, over the same reviewed
library. The server needs `AGENTIC_RETRIEVAL=on`, and a case it answers with the
fixed pipeline is marked ERROR, so a fixed score cannot pass as an agentic one.
A case that fell back after an agentic failure is scored on the fallback answer
and listed with its reason.

```
AGENTIC_RETRIEVAL=on CLAUDE_MODEL=claude-haiku-5-5 npm run dev
node evals/run_eval.js http://localhost:3000             # fixed, same server
node evals/run_eval.js http://localhost:3000 --agentic
node evals/compare.js
```

Results go to `result-<model>-<set>-agentic.json`, so they never overwrite the
fixed pipeline's, and the holdout criterion pairs agentic with agentic.

This is an architecture comparison, not a round: a round changes one of the
prompt, the chunking, top-k or the corpus inside the fixed pipeline. Compare the
two on the same model and the same day. The model chooses its own searches, so
run each agentic set more than once before trusting a difference.

### What "indexed corpus" means here

The literal criterion "zero citations that are not in the indexed corpus" is
unsatisfiable as written, because the skill hardcodes all five federal Layer 1
citations and the Layer 2 guidance citations directly in the prompt. The model
can cite correctly with retrieval returning nothing at all. Scoring that as a
hallucination would score correct behaviour as failure.

So the corpus is defined as the union of:

- every citation shaped string in `data/cards.js`, whether in a `citation`
  field or inside a card's `text`, and
- every citation shaped string in `data/SKILL-v6.7.md`.

Both files are parsed at runtime by `evals/run_eval.js` using the same
extractor that reads the model's answer. Nothing is hardcoded, so the corpus
cannot rot when a card is added or a skill version lands.

Citations the model outputs are sorted into three buckets:

| Bucket | Meaning | Counts as |
|---|---|---|
| IN | exact match, or a broader cite of something in the corpus (model says `1910.252(a)`, corpus has `1910.252(a)(2)(iii)`) | fine |
| DEEPER | the base rule number is in the corpus but the subsection path is not (model says `1910.146(d)(6)`, corpus has `1910.146`) | warning, reported, not a hard failure |
| OUT | no corpus entry shares the base rule number | hard failure, gates the exit code |

DEEPER is split out rather than folded into OUT because a deeper subsection is
usually a real rule, just one the corpus does not carry. It is still worth
seeing: it is the shape an invented detail takes.

Known soft spot: the card `Cal. Code Regs. tit. 8, §2940(c) and (d)` parses as
`2940(c)` only, so a correct cite of `§2940(d)` lands in DEEPER. Harmless given
DEEPER is a warning, but do not be surprised by it.

### Deny list

Three strings are present in the prompt and must never appear in the answer.
They would pass the corpus test, so they are denied explicitly:

- `1910.269(l)(1)(i)` - superseded by `(l)(2)(i)`. The skill says never cite it.
- `1910.333` - named in the skill frontmatter only as "not included until audited".
- `NFPA 70E` - same, excluded pending audit.

Deny matching is on the rule number and anything below it, so `1910.333(b)(2)`
is also denied.

`1910.23(c)(7)` is legitimate: it is a real card (`fed-ladder-traffic`) and a
real Layer 2 row. Do not deny `1910.23(c)` as a whole.

### Pass and flag mapping

The app never emits "pass" or "flag". It emits one of 6 headlines plus an
`OSHA: ... | Safety: ... | Two-person step: ...` line. The mapping below is my
interpretation of the owner's principle, not his specification. It is a
reviewable artifact: if it is wrong, change it here and in the runner.

Predicted `flag` when any of these is true:

1. Headline is "OSHA requires", "OSHA may require", or "makes sense here for safety".
2. The OSHA field is `Yes` or `Need`.
3. The Safety field is `Yes`.
4. Headline is "doesn't show a reason" AND the quote bills Tech 2 hours.

Predicted `pass` otherwise.

Two judgement calls inside that:

- Safety `Need` alone does not flag. "Need the door weight" is a question, not
  a raised requirement. Worked example B in the skill is a justified two person
  job that carries Safety `Need`, and calling it a flag would be wrong.
- OSHA `Need` does flag, because the skill maps OSHA `Need` to the "OSHA may
  require a second tech here" headline, which is explicitly raising a possible
  OSHA requirement.

Every case prints its raw headline type, OSHA field, Safety field, two person
field and Tech 2 hours next to the mapped verdict, so a disagreement with this
mapping is debuggable without a rerun.

### What makes a case fail

A case passes only with zero failure reasons. The reasons are:

- predicted verdict does not match `expected_verdict`
- an OUT of corpus citation appeared
- a deny list citation appeared
- an em dash appeared
- a dollar amount appeared
- the State line is wrong or missing (skipped for the "one person on site" headline)

`expected_issue_type` and `expected_citation` are reported but do not gate the
score. Issue type cannot be scored fairly: the product has no concept of a
logic error, so scoring it would fail the logic cases twice. Expected citations
are all UNVERIFIED (see below), and gating on an unverified expectation would
be unsound.

The State line check is an addition of mine, adapted from `stateOk` in
`tests/run.mjs`. Plan states and their `standards` value are parsed from
`PLAN_STATES` in `data/cards.js`, not hardcoded, and the check expects the form
the route writes:

| State | Expected State line contains |
|---|---|
| not given | `not given` |
| not a plan state | `follows federal` |
| plan state, `standards: "federal"` | `runs its own OSHA plan but enforces the federal standards` |
| plan state, `own` or `mixed` | `has its own OSHA rules` |

The app overwrites the State line in code after generation, so this check is a
regression guard and should always pass.

It did not, from the Oct 19 State line split until the harness fix: the check
still looked for `own OSHA plan`, so every CA, WA and OR case failed whatever
the model wrote (`state-01` to `state-03` here, cases 3, 5 and 13 in
`tests/run.mjs`). A result file from before the fix is not comparable with one
after it.

### The keyword-only caveat

This matters more than the score does.

The 384 dimension all-MiniLM-L6-v2 embedding is computed in the browser. A node
client posting to `/api/check` cannot supply a vector without the model, so
`body.vector` is absent, `isVector` is false, and the route silently falls back
to keyword-only retrieval. Semantic card retrieval and the `past_quotes`
similar jobs block are both skipped.

So the eval exercises a different retrieval path from the one real users get.
The existing `tests/run.mjs` has the same flaw. The runner prints a banner
saying so at the top and the bottom of every run, and records
`"retrieval": "keyword-only"` in the result file. Do not quote the score
without the caveat.

### Citation verification status

Every `expected_citation` in `evals/cases.jsonl` and `evals/holdout.jsonl`
carries a trailing `[UNVERIFIED]` marker. Nothing was checked against osha.gov,
eCFR or dir.ca.gov, because this session had no network route to any of them.
The runner strips the marker before comparing. Before the cases are trusted as
ground truth, someone has to check each citation and drop the marker only for
the ones they confirmed, recording the URL in `notes`.

### Two subsets will fail, by design

These are not defects in the runner and not regressions. They record wanted
scope that the product does not attempt.

- The 5 logic cases (`logic-*`, `hold-logic-01`). The skill has no arithmetic
  or internal consistency layer. Its closest feature is `<steps_needing_two>`,
  which compares Tech 2 hours against steps needing two people. Wrong totals
  and disagreeing counts are not something this product tries to catch.
  `logic-03` (scope versus labor) is the one that may genuinely pass, because
  scope versus labor is exactly what `<steps_needing_two>` covers.
- Electrical lockout (`safety-05`). The skill lists lockout and de-energized
  electrical work as one person by default, and `1910.333` and `NFPA 70E` are
  excluded pending audit. Note that this case bills Tech 2, so the mapping may
  return `flag` and score it as a pass for the wrong reason. The issue type and
  citation columns are what reveal the gap, not the verdict.

Read the baseline number with both subsets in mind.

The 5 logic cases are not the same set as the cases tagged
`expected_issue_type: logic`: `tech2-02`, `tech2-04` and `safety-03` carry that
tag too, so the issue type breakdown's logic row counts 7 in the main set.

What this means for the 90 percent criterion (an estimate until a baseline
exists): 90 percent of 25 cases allows at most 2 failures. If `logic-01`,
`logic-02` and `logic-04` fail as expected, the main score tops out at 88
percent until the product checks quote logic, and a quote logic check is not one
of the four round levers. Raise that with the owner before spending rounds on it.

### Scope limit on this work

The branch that added this file changed only `CLAUDE.md` and `evals/`. The
eval harness fix after it changed `evals/`, `tests/run.mjs` and this file, and
no product code: not `lib/`, not `app/`, not `middleware.js`, not `data/`, and
not `package.json`. If a round needs a product fix, that is a separate change.
The agentic experiment is product code (`lib/agentic.js`, `lib/anthropic.js`,
`app/api/check/route.js`) and came as its own change, off by default.
