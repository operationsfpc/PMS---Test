# Spec — PIF: attach the JD, name the shift, state the joining timeline

**Status: ✅ APPROVED and SHIPPED 2026-08-18** · raised by Karthik.

Answers, verbatim: **1** yes, not replacing · **2** "keep space to type JD.
Field is not mandatory" · **3** yes, all staff and students · **4** yes ·
**5** add rotational/flexible as well · **6** one comment box per option ·
**7** the radio is required at submit, the comment is optional · **8** free
text · **9** leave the live ones untouched · **10** yes.

Two deviations from the recommendations, both because Karthik said so: the
typed JD is **not** required (recommendation 2 said keep it required), and the
joining comment is **never** required, not even for "Joining later"
(recommendation 7). Both are one line of `pif-schema.ts` and one test if they
are ever reversed.

Verbatim request:

> in the PIF, add an option to ATTACH a JD (job description) as PDF FILE.
> Shift time, instead of a text box, change to radio button — Day and Night as
> options with time to be filled as text for night box.
> in offer rollout and joining timeline, instead of a large text box, have radio
> button for immediate joining and joining later. Have a comments box also for
> both the options.

Three changes, all on `/ae/pif` (`src/features/pif/pif-form.tsx`), each with a
consequence somewhere else — the Delivery Head's approval queue, the student's
drive card, and the database.

---

## J1 — Attach the JD as a PDF

**Today.** `jobDescription` is a required free-text box at submit. A recruiter's
JD arrives as a PDF attachment on an email; the AE retypes or pastes a fragment
of it, and the file — the thing the recruiter actually wrote and the student
actually needs — never enters the system.

**Proposed.**

| | |
|---|---|
| Control | "Attach the job description (PDF)" beside the existing text box, in Role details |
| Accepts | **PDF only**, max **5 MB** (the limit every other bucket uses) |
| Count | **One** file per PIF. Replacing it replaces the attachment |
| When it uploads | On save/submit, before the drive row is written — same order as the SRF's marksheets, so an object can never be orphaned by a failed row (the reverse would give a recruiter a dead link) |
| Draft | A draft may be saved with or without it |
| Storage | New private bucket `job-descriptions`, path `<drive_id-less>/…` — see Q3 |
| Read by | AE (own drives), Delivery Head, Central CPC, campus staff, **and the student** if Q4 = yes. Always a short-lived signed URL, never a public object (PRD §21.2) |
| Where it shows | AE's own drive list · **Delivery Head's approval queue** (they are approving the role; the JD is the evidence) · student's "View more" card, if Q4 = yes |
| Text box | Stays. **Q2 decides whether it stays required.** |

Layer 0 gets `src/domain/attachments.ts`: `validateJobDescriptionFile(file)` —
type, size, empty-file — so the rule is stated once and tested without a browser.

---

## J2 — Shift: Day / Night radio, with the night timing typed in

**Today.** `shiftType` is a free-text input. Live drives contain `"General"`.
`min`/`max` nothing; anything goes; the student's card prints it verbatim.

**Proposed.**

```
Shift
  ( ) Day     ( ) Night
              └── Night shift timing  [ 9.00 pm – 6.00 am        ]   (required when Night)
```

- Two options: **Day** and **Night**. Nothing else (Q5 if rotational/flexible
  is needed — it is common in BPO hiring and this is a one-word change now,
  a migration later).
- The timing text belongs to **Night only**, per the request. Choosing Day and
  then Night must not carry a stale Day timing anywhere — the field is cleared
  when Day is selected.
- **Night with no timing is refused at submit** (a draft may be incomplete).
  "Night shift" with no hours tells a student nothing they can plan around.
- Neither radio is preselected. A preselected Day is an answer nobody gave.
- Storage: `shift_type` keeps its column and now holds `day` | `night`; a new
  `shift_night_timing text` holds the words. A check constraint refuses a
  timing against a Day shift **in both directions** — the same shape as 0048's
  board/state rule.
- **Legacy rows are not backfilled.** `"General"` is what an AE typed; guessing
  it means Day is inventing a fact. `describeShift` (domain) renders a known
  value as "Day shift" / "Night shift (9pm–6am)", an unrecognised legacy string
  verbatim, and a null as **"Not recorded"** — the `describeBoard(undefined)`
  lesson: anything rendered once per row must survive a value that predates it.

---

## J3 — Joining: Immediate / Later radio, with comments

**Today.** `timelineNotes` is a 3-row textarea labelled "Offer rollout and
joining timeline".

**Proposed.**

```
Offer rollout and joining
  ( ) Immediate joining     ( ) Joining later
  Comments  [                                             ]
            (visible for both options)
```

- Radio: `immediate` | `later`, stored in a new `joining_timeline` column.
- **One** comments box, shown for either choice, keeping the existing
  `timeline_notes` column and its data. (Q6 — the alternative reading is a
  separate box per option, which would need two columns and would leave one of
  them stale whenever the AE changes their mind.)
- Comments are **optional** by default (Q7). "Later" arguably needs a date or a
  month, but the request says comments, so comments it is unless told otherwise.
- Required at submit? **Q7.**
- Legacy rows keep their notes with a null radio → "Not recorded".

---

## What this touches

| Layer | Files |
|---|---|
| 0 | `src/domain/shift.ts` (new — `SHIFT_TYPES`, `describeShift`, `shiftTimingRule`), `src/domain/joining.ts` (new — `JOINING_TIMELINES`, `describeJoining`), `src/domain/attachments.ts` (new), `src/domain/types.ts` (enum drift guard) |
| 1 | `pif-schema.ts` (3 fields + 2 cross-field refinements), `pif-form.tsx`, `pif-repository.ts` (upload then insert), `delivery-head/approval-repository.ts` + queue (open the JD), `student/drives-view.ts` + `drives-list.tsx` (shift wording, JD link) |
| 2 | `0051_pif_jd_shift_and_joining.sql` — bucket + policies, `drives.jd_storage_path` / `jd_file_name` / `jd_size_bytes`, `drives.shift_night_timing`, `drives.joining_timeline`, two check constraints |

No RLS change to `drives` itself: whoever may read the drive may read its JD.

---

## Questions — answer by number

1. **Does the PDF replace the typed JD, or sit beside it?** Recommended:
   beside. A file cannot be searched, excerpted onto a card, or read on a phone
   in a lecture hall.
2. **With a PDF attached, is the typed job description still required at
   submit?** Recommended: **yes, still required** — the student's drive card
   and the recruiter export both read text, and "see attachment" is not a
   description. Alternative: require *either* text *or* a PDF.
3. **Who may download the JD?** Recommended: **every signed-in staff role, and
   students who can see the drive.** The alternative (staff only) means the
   student applies to a role whose description the AE summarised in one line.
4. **Show the JD on the student's drive card?** Recommended: yes, as
   "Download the job description (PDF)". Follows from 3.
5. **Shift — only Day and Night?** Or add **Rotational / Flexible**? Adding it
   now is free; adding it later is a migration and a backfill decision.
6. **Joining comments — one box for both options, or one box per option?**
   Recommended: one box.
7. **Are the joining radio and its comments required at submit?**
   Recommended: **radio required, comments optional**, except **required when
   "Joining later"** is chosen — "later" with no elaboration is not information
   a student can act on.
8. **Night timing format** — free text (`9.00 pm – 6.00 am`), or two time
   pickers (from / to)? Recommended: free text, as asked. Pickers imply a
   precision recruiters do not give.
9. **Existing live drives** (four published, `shift_type = 'General'`, free-text
   timelines): leave them exactly as they are and render them verbatim?
   Recommended: **yes** — no backfill, nothing invented.
10. **Should the Delivery Head's approval queue show the JD link?**
    Recommended: yes. They approve the commercials of a role; the JD is the
    role.

---

## Mockup

`docs/specs/2026-08-18-pif-jd-shift-joining-mockup.html` — the three blocks
only, in the brand palette, with the Night and Later branches both open so the
conditional fields are visible.
