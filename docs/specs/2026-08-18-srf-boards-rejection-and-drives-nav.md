# Spec — SRF boards & university · reject with comments · Drives nav

**Status:** ✅ APPROVED 2026-08-18 ("go ahead with 1-6"), item 4 revised at approval — three tabs
**Raised:** 2026-08-18 (Karthik, four items)
**Answers recorded:** 1a · 2 required for all · 3 state named · 4 "University / Board" · 5 yes ·
6 (a) · 7 yes · 8 recommendation accepted · 9 both · 10 yes · 11 screenshot
`docs/inbox/Screenshot 2026-08-17 at 3.26.37 PM.png`
(the filename carries a U+202F narrow no-break space before `PM` — quote it, and glob it in bash)

---

## Item 1 — Board on 10th and 12th, university on the diploma

### What the student sees

Class 10 fieldset gains, **before** the marks:

| Field | Control | Rule |
|---|---|---|
| 10th board | select | **Required.** `State Board · CBSE · ICSE (CISCE) · NIOS · International Baccalaureate (IB) · Cambridge (IGCSE / O-Level) · Other` |
| 10th board state | select, **only when `State Board`** | Required then. All 28 states + 8 union territories |
| 10th board (other) | text, **only when `Other`** | Required then, max 120 |

Class 12 fieldset gains the same three, with `ISC (CISCE)` in place of `ICSE (CISCE)` — CISCE
runs ICSE at class 10 and ISC at class 12, so one enum value `cisce` carries a **class-specific
label**. One vocabulary, two labels; no second enum to drift.

Diploma fieldset gains **"University / Board"** (`diploma_university`), free text, max 160.
Required **only when a diploma is declared** — the same all-or-nothing rule
`diplomaInstitution` already follows (`srf-schema.ts` `superRefine`). A diploma awarded by a state
technical-education board is not a university, which is why the label names both.

### Why a select and not a text box

Free text yields `cbse`, `C.B.S.E.`, `Central Board` and `CBSE ` — four boards to Postgres, one
board to a human, and no report can ever group them. The state is a **second** control rather
than 36 entries spliced into the board list, so "which board" and "which state" stay separately
answerable and separately filterable.

### Layers

| Layer | Change |
|---|---|
| 0 | **new** `src/domain/boards.ts` — `SCHOOL_BOARDS`, `boardLabel(board, level)`, `INDIAN_STATES`, `describeBoard(selection)` (what the record and the coordinator's queue read back), `validateBoardSelection({ board, state, other })` returning problems. 100% lines + branches |
| 0 | `src/domain/srf-progress.ts` — the two boards count towards section 2's completion, like `tenthInstitution` does |
| 1 | `srf-schema.ts` — `tenthBoard`, `tenthBoardState`, `tenthBoardOther`, the twelfth trio, `diplomaUniversity`; every rule delegates to `validateBoardSelection` |
| 1 | `srf-page.tsx` — the three fields per school fieldset (grid goes to 2 columns × 2 rows so the marks still sit beside their marksheet), diploma university beside the diploma college |
| 1 | `srf-profile.ts` — read back for the record view and the rejected-form prefill; `SRF_PROFILE_COLUMNS` extended (proved by `query-contract.test.ts`) |
| 1 | `srf-repository.ts` — carried into the `submit_srf` payload |
| 1 | `verification-repository.ts` + `srf-verification-queue.tsx` — the coordinator verifies a board against the marksheet, so the queue shows it |
| 1 | `srf-summary.tsx` / `/student/profile` — shown back in the read-only record |
| 2 | **`0048`** — Postgres enum `school_board` (mirrored in `types-drift.test.ts`), `students.tenth_board`, `tenth_board_state`, `tenth_board_other`, `twelfth_*` ×3, `diploma_university`; check constraints `board_state_only_for_state_board` and `board_other_only_for_other` in **both** directions; `submit_srf` replaced (arity unchanged) to write them |

**Nullable, no backfill.** Five students are already registered and three are approved; inventing
a board for them would be asserting a fact nobody checked. The columns are nullable and the
**form** demands them, so every future submission carries them and no existing row is broken.
`describeBoard(null)` reads "Not recorded", never a blank cell.

---

## Item 2 — the marks-scale question says which college it means (answer 6a)

`srf-page.tsx` today asks **"How your college reports marks"** in the UG/PG fork, and the hint
says "Applies to every semester below". For a PG student those semesters are their **PG**
semesters (`MAX_SEMESTERS.pg = 4`), and the finished UG degree has its **own** scale selector,
labelled only "UG scale".

| Where | Now | After |
|---|---|---|
| Fork, when UG | How your college reports marks | **How does your college report marks?** |
| Fork, when PG | How your college reports marks | **How does your PG college report marks?** |
| Completed-UG block | UG scale | **How does your UG college report marks?** |

Driven by a domain function (`marksScaleQuestion(level)`) rather than a ternary in JSX, so
`copy.test.ts` can hold the wording and the two questions cannot drift apart.

⚠️ **Recorded deviation from the literal request**, agreed as 6(a): the question you pointed at
becomes *PG*, and the word *UG* lands on the field it actually describes. Reverting to the
literal wording is one string plus one test.

---

## Item 3 — reject with comments, and a form that comes back filled in

### 3a. The Reject control (this is the missing half nobody could work around)

`/cpc/verification` offers **Approve** and nothing else, so **no coordinator can reject a form
today**. Everything behind it already exists: `decideSrf` refuses an empty reason, the repository
writes `srf_rejection_reason`, `0020` permits the student's `srf_rejected → srf_submitted`, and
`0042` restricts the decision to the campus CPC in the database.

- Per row: **"Send back for changes"** → reveals a required comment box (`textarea`, labelled
  *"What does this student need to correct?"*) and a **Send back** button.
- Empty or whitespace-only comment: the domain's own message, shown by the field, request never
  sent.
- Saved → the row leaves the queue, like an approval.
- **Answer 7:** campus CPC only. No Reject button anywhere else, and the database refuses it
  regardless (`verification_is_campus_cpc_only`).

### 3b. The rejected form is prefilled (answer 8)

`submit_srf` sets `srf_draft = null`, and the form merges **roster identity + draft** only — so a
sent-back student today opens a **blank** form and retypes every mark, school and phone number.
"Edit and resubmit" is currently "fill it in again".

- **new** `src/domain/srf-draft.ts` → `srfValuesFromSubmitted(record)`: builds form values from
  what was actually submitted. Structural input, no feature imports.
- `srf-page.tsx` opens on `draft ?? srfValuesFromSubmitted(profile)`. **A real draft still wins** —
  it is newer than the submission — and **roster identity still wins over both**, unchanged.
- **Uploads are re-attached.** A browser cannot be handed back a `File`, and `submit_srf` deletes
  and re-inserts the semester rows, so the old `marksheet_id` links go with them. The form says so
  in one line above section 2: *"Your marksheet uploads need attaching again — everything you
  typed is already filled in."* Silence here is what would look like a bug.

### 3c. The student is told, in both places (answer 9)

- **Notification** (`0048`, a `security definer` trigger in the shape of `0043`'s): on
  `srf_status → srf_rejected`, insert `kind = 'srf_rejected'`, title *"Your registration form was
  sent back for changes"*, body carrying the coordinator's comment. Opted-out students are not
  notified — the same branch `0043` uses.
- **Dashboard**: `student-dashboard-view.ts` reads `srf_rejection_reason`; `student-progress.ts`
  appends the coordinator's words to the existing "needs changes" detail. The action link
  (`Update my registration form`) already exists.

### 3d. The coordinator sees it is a resubmission (answer 10)

Queue row gains a **"Resubmitted"** badge and *"You sent this back: …"* when
`srf_rejection_reason` is non-null on a `srf_submitted` row — so they are reminded what they
asked for before they judge it. Ordering stays oldest-submitted-first; a resubmission is a fresh
`srf_submitted_at`, so it joins the back of the queue.

**Not changed:** the reason is deliberately **not** cleared on resubmission — it is what makes
3d possible — and it is cleared on approval, which `verification-repository.ts` already does.

---

## Item 4 (11) — Drives has THREE tabs (revised at approval)

> "approved is yet to publish. these should be in yet to publish … we can have a third box,
> there called completed. This way we have three tabs — approved = yet to publish; published —
> page name can be live; completed. drafts can be removed."

Central CPC sidebar, `ROLE_NAVS` in `src/components/app-shell.tsx`:

```
Drives                        Drives
  Yet to publish        →       Yet to publish   approved only
  Published                     Live             live · applications_closed · in_rounds
  All drives                    Completed        completed
```

| Tab | Route | Statuses | Design |
|---|---|---|---|
| Yet to publish | `/central/drives/yet-to-publish` | `approved` | **stays the cockpit** — it carries the Publish action, and a card list has nowhere to put it |
| Live | `/central/drives/live` | `live`, `applications_closed`, `in_rounds` | the All-drives card design |
| Completed | `/central/drives/completed` | `completed` | the All-drives card design |

- `/central/drives/published` and `/central/drives` keep answering (→ Live), so no bookmark breaks.
- **Drafts are gone from the Central CPC**, as asked.
- ⚠️ **ASSUMPTION — UNCONFIRMED (A39).** `submitted` (raised by the AE, still on the Delivery
  Head's desk) and `rejected` now appear on **no** Central CPC screen. That follows from `0047` —
  raise is the AE's, approve is the Delivery Head's, publish is the Central CPC's — so a drive
  nobody has approved yet is not theirs to see. One array to reverse
  (`DRIVE_TAB_STATUSES` in `src/domain/drive-lifecycle.ts`).

- Live and Completed render **`DrivePortfolioPage`** (the card design: pipeline bar,
  Applied/Shortlisted/In rounds/Offers/Not selected, applicants, *Shortlist applicants*) instead
  of the cockpit list.
- **The three chips are removed** — *All my drives · Raised by me · Approved by me* — along with
  `Filter`, `FILTERS` and the `filter` state. For an AE every drive is one they raised and for a
  Delivery Head every drive is one they approved, so the chips filtered a list to itself.
  `involvementIn` stays: it still draws the "Raised by you" badges.
- ✅ **Settled at approval:** an `approved` drive belongs under *Yet to publish*, and
  `completed` gets its own tab rather than sitting inside a "published" bucket.
- `/my-drives` **stays** for the AE and the Delivery Head (their heading is "My drives"), and
  stays reachable so no bookmark breaks.
- `navigation.test.ts` / `screens.test.tsx`: a test asserts the Central CPC's Drives group is
  exactly *Yet to publish · Live · Completed*, and that no screen renders the retired chips.

---

## Test plan (RED first, every item)

| Layer | What gets a failing test before any code |
|---|---|
| Domain | `boards.test.ts` — every board label per level, state required only for `State Board`, other required only for `Other`, both refused when not applicable, `describeBoard(null)`; `marksScaleQuestion` per level; `srfValuesFromSubmitted` (draft wins, roster wins, files never restored) |
| Schema | `srf-schema.test.ts` — a submission missing a board is refused; a diploma with no university is refused; a diploma left blank is accepted |
| Component | `srf-form.test.tsx` — the state select appears only for State Board; the other box only for Other. `srf-verification-queue.test.tsx` — reject needs a comment, the row leaves, the Resubmitted badge. `srf-page.test.tsx` — a rejected form opens carrying the submitted values and says uploads need re-attaching. `portfolio-page.test.tsx` — the chips are gone, published statuses only |
| DB (PGlite) | `0048` — enum matches the domain, both check constraints in both directions, `submit_srf` round-trips the six new fields, the rejection notification fires once and not for an opted-out student |
| RLS (live, rolled back) | the campus CPC's reject succeeds; a Central CPC's identical write is refused by `verification_is_campus_cpc_only`; the student's `srf_rejected → srf_submitted` succeeds; a student cannot set `srf_approved` |
| E2E | the Playwright journey still passes |

`pnpm check` must exit 0 (coverage gates included) before anything is deployed, and the live
bundle is diffed byte-for-byte against `dist/` after.

---

## Open items carried forward, not fixed here

- **P9** (two live drives lost their declared 7.50) — untouched.
- The **two different upload rules** for the same marksheet (`add-semester.tsx` accepts images,
  the SRF accepts PDF only) — untouched, still open.
- `students.certifications` — still not dropped.
