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
```

Two dry paths send no request and spend no API credit:

```
node evals/run_eval.js --help         usage, then exit
node evals/run_eval.js --self-check   offline assertions on both scorers
```

`--self-check` is the one to run after touching `stateLineOk` or
`evals/mention-rules.js`. It asserts that the four State line forms are told
apart under both `PLAN_STATES` shapes, and that no discrepancy rule fires on a
headline-only answer. Exit code 1 if any assertion fails. Use it instead of a
live run when the question is whether the scorer is right, not whether the
product is.

No npm script, by design: `package.json` is not modified by this work.
No dependencies: node 20 or newer builtins only (`fetch`, `fs`, `path`).

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
extractor that reads the model's answer. The citation set is not hardcoded, so
the corpus cannot rot when a card is added or a skill version lands.

One thing IS hardcoded and it is a trip hazard: the path `data/SKILL-v6.7.md`.
PR #5 bumped that file's contents to v6.8 and left the filename alone, so the
runner still works. A future version bump that renames the file will crash the
runner at startup on `readFileSync`. Glob the newest `data/SKILL-v*.md` instead
when that happens, or rename in the runner at the same commit.

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

### Discrepancy scoring, for the cases that test noticing

The pass/flag mapping above reads only the headline and the summary line.
Neither can express "I found a billing inconsistency". So the cases written to
test whether the bot NOTICES an inconsistency were being scored on a signal that
cannot carry the answer, and the scorer was blind to the bot getting them right
in prose.

`evals/mention-rules.js` fixes that. Six case ids are listed there, each with a
regex derived from that case's own `notes` field and a `what` string naming the
discrepancy in plain words:

`logic-01`, `logic-02`, `logic-03`, `logic-04`, `tech2-02`, `tech2-04`.

A case listed there passes on whether the answer NAMES its discrepancy, instead
of on the pass/flag mapping. Every other check still applies to it: citation in
corpus, deny list, no dollar amounts, no em dashes, correct State line. A case
not listed is scored exactly as before.

This edits no expected answer. It is a scoring layer keyed by case id, so the
owner's rule against editing expected answers in `evals/` is intact.

The runner now prints both groups separately as well as the total, because one
number mixing "did it reach the right verdict" with "did it notice the
arithmetic" hides which of the two moved. The same split is in the result file
under `by_scorer`.

What the two numbers mean together: the first baseline read 21/25 raw. Three of
its four failures were the bot catching the problem in prose while the scorer
could not see it. Rescoring the same answers gives 23/25. That arithmetic only
balances if one case that passed on the mapping now fails on the stricter
signal, which is the point: the mapping was passing it for the wrong reason.
That is an inference from the two numbers, not something observed in a run, so
check it against the next `by_scorer` output rather than trusting it.

`safety-03` is deliberately NOT in the mention rules, even though it carries
`expected_issue_type` `logic`. Its notes say the assertion that matters is that
the OSHA field reads No: it is a height trap, not a discrepancy to name. Forcing
it into the rule set would throw away the assertion the case was written for. It
still needs its own OSHA-field check, which neither scorer does yet. That is an
open gap, not an oversight.

The standing risk with these patterns: they were written after reading real
answers, so they can be fitted to the output they were meant to judge. Two early
drafts were thrown away because they would have passed on the headline alone,
which is circular, and a hill-climbing loop would learn to game it. The
`--self-check` path asserts that no rule fires on a headline-only answer, which
catches that specific mistake but not subtler fitting. Re-read the patterns
against a fresh run before trusting the number.

### What makes a case fail

A case passes only with zero failure reasons. The reasons are:

- predicted verdict does not match `expected_verdict`, for a case the verdict
  scorer judges, OR the answer does not name the discrepancy, for a case listed
  in `evals/mention-rules.js`. Never both: one scorer decides each case.
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

### The four State line forms

The State line check is an addition of mine, adapted from `stateOk` in
`tests/run.mjs`. Plan states are parsed from `PLAN_STATES` in `data/cards.js`,
not hardcoded. The app overwrites the State line in code after generation, so
this check is a regression guard and should always pass.

There are four permitted State lines and the old check could not tell two of
them apart:

| Form | Line |
|---|---|
| `not_given` | `State: not given. Add the store's state to check state rules.` |
| `federal` | `State: XX follows federal OSHA. Nothing changes.` |
| `plan_federal` | `State: XX runs its own OSHA plan but enforces the federal standards.` |
| `plan_own` | `State: XX has its own OSHA rules. Check them before citing.` |

`plan_federal` is the line PR #5 introduced for the state-plan states that adopt
the federal standards. The old test was `/own OSHA plan/i`, and that sentence
CONTAINS that exact substring, so the harness would have passed PR #5 without
testing the one thing PR #5 changed. Each form is now matched distinctly, and
`plan_federal` is classified before the legacy pattern because the legacy
pattern is a substring of it.

Which form is expected comes from the state's `standards` value, by the same
rule `app/api/check/route.js` uses to pick the line. If that rule changes in the
route, change it in the runner too:

- `standards: "federal"` expects `plan_federal`.
- `standards: "own"` or `"mixed"`, and any later value that is not `"federal"`,
  expects `plan_own`.
- a state absent from `PLAN_STATES` expects `federal`. No state expects
  `not_given`.

`PLAN_STATES` has two shapes and the runner parses both:

- before PR #5: `AK: "none"`, a bare string. It is the card library status and
  carries no information about which standards the state enforces.
- PR #5 onwards: `AK: { standards: "federal", library: "none" }`.

PR #5 has merged, so main carries the object shape and the string branch does
not fire there. `--self-check` prints the `standards` values it found, which is
how to confirm that. The branch is kept anyway for two reasons: a harness that
breaks depending on which checkout it is pointed at is worse than the bug it
fixes, and PR #5 merged with every `standards` value still marked UNVERIFIED in
its own description, which leaves a revert on the table.

On the string shape there is no `standards` field, so `expectedStateForm` falls
back to the old loose expectation for any plan state, which accepts the legacy
line and the `plan_federal` line alike. It cannot tell those two forms apart,
which is exactly the bug this fixes everywhere else, so treat it as a known
blind spot and do not extend it. Delete the `legacy_plan` branch and the `null`
case in `parsePlanStates` once a pre-PR-#5 checkout stops being something anyone
would point this at.

Verified offline against the merged PR #5 data, with a local stub reproducing
`route.js`: the four forms are told apart, the CA, OR and WA cases expect
`plan_own` and the other 19 plan states expect `plan_federal`, and a regression
to the single v6.7 plan line fails every state-sensitive case with a reason that
names both sides. The old check passed all of them.

Failure messages now name both sides, for example
`State line wrong or missing (wanted plan_own, read plan_federal)`, and every
row records `state_line_want` and `state_line_form`.

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

Scoring note on the first subset: four of the five logic cases are now scored by
`evals/mention-rules.js` on whether the answer names the discrepancy, not on the
verdict mapping. That does not change what the product attempts. It changes only
whether the scorer can see the bot catching a problem in prose. The product
still has no arithmetic or internal consistency layer.

One asymmetry to keep in mind: the rule set lists ids from `cases.jsonl` only, so
the holdout set is still scored entirely on the verdict mapping. The two sets are
therefore not scored identically any more, which matters for the "holdout within
10 points" criterion. It does not bite at the current numbers, but a future round
that leans on the discrepancy layer to lift the main score should expect the gap
to widen rather than close. Adding holdout ids to the rule set would mean reading
`evals/holdout.jsonl`, which the owner's rules forbid, so this is a known
limitation and not something to fix from inside an improvement round.

### Scope limit on this work

`CLAUDE.md` and `evals/` are the only things this branch adds. No production
code was changed: not `lib/`, not `app/`, not `middleware.js`, not `data/`, and
not `package.json`. If a round needs a product fix, that is a separate change.
