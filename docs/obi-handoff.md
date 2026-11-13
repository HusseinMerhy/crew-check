# Quote Builder and OBI: the connection

For OBI's builder. Quote Builder checks quotes; OBI is the system people work in. This connection
lets OBI show Quote Builder's verdict at its quote audit step (step 7 of the work order lifecycle,
"TL/ATL quote audit", in OBI's roadmap) without building a second checker.

## What OBI gets

- **The verdict line**, the same one written to the "OSHA Check" field in ClickUp:
  `NO REASON: remove Tech 2 or add a two-person step`, `ASK FIRST: <one fact>`,
  `OSHA: Tech 2 required by OSHA`, `OK SAFETY: ...`, `OK TWO-PERSON: ...`, `ONE TECH: ...`.
  The keyword before the colon never changes, so OBI can branch on it.
- **NTE:** whether the quote's total is over the client's NTE, as a state and a percent
  (`over`, 138). Never an amount.
- **Overtime:** whether overtime is billed and whether its reason is written. The overtime rule is
  not agreed yet, so treat it as a note for review, not a block.

No answer carries a dollar amount or a client name beyond what OBI sent.

## How to call it

The connection is off until `OBI_API_KEY` is set in Quote Builder's Vercel settings. Hector sets
it and gives the key to OBI's builder directly, never in chat or in a file. OBI sends it on
every call:

```
Authorization: Bearer <OBI_API_KEY>
```

### The verdict already stored for a work order

```
GET https://crew-check-five.vercel.app/api/obi?task=<ClickUp task id>
```

Answers 200 with:

```json
{ "ok": true, "task_id": "86a2tqk0c", "task_name": "...", "status": "quote ready",
  "checked_at": "2026-11-13T12:42:54Z",
  "line": "NO REASON: remove Tech 2 or add a two-person step", "keyword": "NO REASON",
  "headline": "This quote doesn't show a reason for a second tech.",
  "current": true, "quote_check": false,
  "nte": { "state": "over", "pct": 138, "text": "Over NTE: ..." },
  "overtime": { "billed": true, "reason": false, "text": "..." } }
```

`current: false` means the quote in ClickUp changed after the check and has not been checked
again yet. 404 means the work order has not been checked.

### Check a quote now

```
POST https://crew-check-five.vercel.app/api/obi
{ "quote": "<the quote text>", "state": "TX", "nte": 450 }
```

`nte` is optional. Answers with `line`, `keyword`, `headline`, `answer` (the full explanation),
`nte` and `overtime`. Each call is one model call and spends Quote Builder's API credit, so call it
when a quote is submitted for approval, not on every keystroke. It takes 5 to 20 seconds.

## Suggested use in OBI

1. When a quote moves to pending approval, call `POST /api/obi` with its summary text.
2. Show the line next to **Approve**, the way OBI shows the NTE lock: `NO REASON` and `ASK FIRST`
   as a warning the approver reads first, the others as a plain note.
3. Do not block on it at first. Measure how often approvers agree before making it a gate.

## Limits

- The check reads the quote's text only. A reason written somewhere else (a call, a photo) is not
  seen; the reason finder in Quote Builder covers a pasted call.
- Keyword search only through this connection (no meaning vector), the same as the daily run.
- ClickUp stays the source of work orders until OBI replaces it; the tool writes only the
  "OSHA Check" field there.
