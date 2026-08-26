# Spec — "Offer declared" locks the round row

**Date:** 2026-08-26
**Requested by:** Karthik (three screenshots, `docs/inbox/WhatsApp Image 2026-08-25 at 17.27.04 / .12 / .19.jpeg`)
**Approved:** 1a · 2a · 3a · 4a ("go with your recommendations")

> "When a student reaches the final selection stage, the status on the right
> still shows as 'Selected' and their checkbox remains active. Please update
> this status label to 'Offer Declared' or 'Job Offered' … and prevent further
> selection actions."

## The defect

`src/features/central-cpc/results-page.tsx` locks a participant row only when
the student sits in a **later** round (`advancedBeyond`, F1). The final round
has no later round, so nothing ever locks there — and the page has no knowledge
of offers at all: `ResultsView.participants()` reads attendance, results and
slots, and nothing else.

So a student with a declared offer still reads **"Selected"**, keeps a live
checkbox, and can be re-marked Selected / Rejected / On hold — the round result
behind a live offer can be reversed by a mis-click.

Final selection already knows better: it shows a green **"Declared"** badge and
withdraws the declare form once the offer exists.

## Decisions

1. **Wording: "Offer declared"** (1a). It matches the Final-selection badge and
   the PRD's "being placed is *declared* here". Students keep their own phrase,
   "Offer received" (4a) — two audiences, two phrasings, neither invented here.
2. **Trigger: an offer actually declared on Final selection** (2a). Not "selected
   in the last round": that would announce an offer nobody has made, on the same
   screen that says "Declare offers on Final selection", and the offer is the
   placement record (R9).
3. **Lock: the row loses its checkbox** (3a), exactly as an already-advanced row
   does, so no bulk action can reach it. Attendance is untouched — it records
   what happened, it is not a decision.
4. Nothing else changes. The Live-drives applicant list keeps "Offer received".

## Design

The label and the lock are **one decision**, so they are one pure function —
not two conditions drifting apart inside a component.

`src/domain/round-outcome.ts`

```ts
describeParticipantOutcome({ result, advanced, offerDeclared })
  → { label, note, editable }
```

Precedence — **offer > advanced > plain result** — the same order
`applicationProgress` already uses, because an offer is the outcome:

| Facts | label | note | editable |
|---|---|---|---|
| `offerDeclared` | `Offer declared` | — | **false** |
| `advanced`, result `selected` | `Selected` | `advanced` | false |
| `advanced`, no result | `—` | `advanced` | false |
| result `on_hold` | `On hold` | — | true |
| no result | `Not recorded` | — | true |

`note` is returned separately so the page can keep rendering "(advanced)" in
its lighter style; the CSS `capitalize` class goes, because it would render
"On Hold" and "Offer Declared" — the rest of the app is sentence case.

**Layer 1.** `ResultsPage` gains `offered?: ReadonlySet<string>` — application
ids holding a declared offer — alongside the existing `locked`. The checkbox and
the label both come from `describeParticipantOutcome`; the component decides
nothing.

**Layer 2.** `DriveRoundsView.offerHolders(driveId)` returns those ids: the
drive's offers give the student ids, the drive's applications map them back to
applications. Loaded by the rounds page beside the participants, so it refreshes
on the same beat as everything else.

No migration. No RLS change — `offers` is already readable by the operators who
reach this screen.

## ⚠️ Noted at the call site

There is **no withdraw-an-offer path** in the app. Under this change, a declared
offer freezes that round's result permanently. That is consistent with the offer
being the placement record — but if an offer is declared by mistake today, only
a database edit undoes it. Flagged to Karthik; an undo is a separate spec.

## Test plan (TDD, RED first)

| Layer | Test |
|---|---|
| `src/domain/round-outcome.test.ts` | every row of the table above; offer outranks advanced; 100% branches |
| `src/features/central-cpc/results-page.test.tsx` | an offer-holder shows "Offer declared", has no checkbox, and cannot be reached by the bulk bar |
| `src/features/central-cpc/results-view.test.ts` | `offerHolders` maps offers → applications and ignores other drives |
