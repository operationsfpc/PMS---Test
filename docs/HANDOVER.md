# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
Last updated at commit `7fc594e`. **1556 tests passing across 107 files**, plus
**1 Playwright journey** — re-run at the start of the next session, not
remembered. **`pnpm check` exits 0** — lint, typecheck and every coverage gate.

📌 **THE FIRST REAL SUBMISSION LANDED IN PRODUCTION.** See §1b. The evidence
chain that every session since 2026-08-04 has been asking someone to prove is
now proven against live data, not against MSW.

⚠️ **Two corrections to earlier entries in this file.**
1. Commits `a4f1c9e` and `d0c1e2f`, cited in previous headers, **do not
   exist** — they were written into the doc before the commit was made. Real
   HEAD is `7fc594e`. Quote a hash only after `git log` shows it.
2. **Work labelled "2026-08-06" throughout this file, `docs/ASSUMPTIONS.md`
   and several code comments was actually done on 2026-08-05.** The system
   clock and the database agree (`date` → Wed Aug 5 2026 IST; `select now()`
   → 2026-08-05 UTC). The day is wrong, not the order; treat "2026-08-06" as
   a label for the last block of work, not a date.

**Live and shipped 2026-08-06:** <https://fpc-pms.faceprep.workers.dev>
(version `040eb121-2bdb-46b3-952f-77010d0614d0`) · database on Supabase
ap-south-1 · migrations `0001`–`0026`, **local == remote** (`supabase migration
list --linked`).

Verified after shipping 2026-08-06, not assumed:
- `student_semesters.marksheet_id` is `NOT NULL` on the remote
- `document_kind` carries `ug_consolidated_marksheet`; `students.ug_marksheet_id`
  exists
- both new triggers are present: `enforce_marksheet_belongs_to_student`,
  `enforce_ug_marksheet_belongs_to_student`
- the `marksheets` bucket is private, 5 MB, pdf/jpeg/png, and the
  "students upload own documents" INSERT policy covers it
- live row counts **unchanged** (3 students, 1 drive, 5 profiles, 1
  self-placement): `0023` adds constraints only, never data
- the deployed JS hashes **identically** to the local build
  (`e70663000ea82215…`, 740 291 bytes) and contains "Declared semesters",
  "No semesters declared", "Consolidated UG marksheet"; the retired
  "Add another semester" / "Remove last semester" strings are gone

⚠️ **The edge cache serves a stale `index.html` for a minute or two after a
deploy.** The first verification fetch returned the PREVIOUS asset name and
looked like a failed deploy. `cache-control` is `max-age=0, must-revalidate`,
so browsers revalidate and real users are fine — but append a cache-buster
when you verify, or you will chase a deploy that already worked.

Earlier, still true (shipped 2026-08-05):
- `is_campus_reader()` includes `key_account_manager`; `is_org_reader()`
  includes `enterprise_relations`; the old `semesters_rw_staff` is gone

---

## 0. The standing rule (from CLAUDE.md — non-negotiable)

**TDD is mandatory.** Red → green → refactor. No production code before a
failing test. Never edit a test to fit broken code. Never `.skip` to go green.

Make reasonable assumptions and keep moving; mark them
`⚠️ ASSUMPTION — UNCONFIRMED` at the call site and list them in
`docs/ASSUMPTIONS.md`.

---

## 1a. UAT round 1 — all six items fixed and shipped (2026-08-05)

| # | Reported | Fix |
|---|---|---|
| 1 | Registration form not submitting | `0020` — **it never could** |
| 2 | No way back to Home or previous sections | Progress pills are links, sections have anchors, header links to the dashboard |
| 3 | Off-campus offer letter not mandatory | `0022` — required in DB, domain and UI; coordinator gets a signed link |
| 4 | Progress tracker not reflecting real progress | `src/domain/srf-progress.ts`; it was hardcoded |
| 5 | No draft / auto-save | `0021` — debounced auto-save + a **Save draft button that did nothing before** |
| 6 | Opt-out declaration not mandatory | `0022` — same shape as (3), photographs accepted |

### Why (1) happened, because it will happen again

`protect_verified_academics` (0009) refused any student change to
`tenth_percentage`, `twelfth_percentage` or `srf_status`. The SRF writes all
three in one statement, so **every submission had always failed**.

Nothing caught it because the layers were tested apart: `srf-repository` against
MSW, which has no triggers, and the trigger with raw SQL that never resembled a
submission. `src/db/srf-submission.test.ts` is now that missing middle — the
exact statement the repository issues, run as the student who issues it.
**When you add a write a student performs, test it there too.**

The guard's intent was right and is unchanged; it just never distinguished
*declaring* marks from *changing verified* ones. Before verification the figures
are the student's to correct; after `srf_approved` they are the coordinator's.

### Live data to chase

- **One `self_placement_request` predates the offer-letter requirement.** Both
  new constraints are `NOT VALID` so it survives; a coordinator should ask that
  student for their letter, or reject it.
- Students on the live project: 3, none `srf_approved`. Now that submission
  works, getting one through SRF → verification proves the chain for the first
  time.

---

## 1b. 📌 The first production submission — verified 2026-08-05 07:36 UTC

`Shashwathi Test` (roll `9876543`) submitted the rebuilt SRF **53 seconds
before this session's first query**, and the whole chain held. Read live, not
inferred:

| What was unproven | Now |
|---|---|
| A real file reaching the `marksheets` bucket | **4 objects**, every one under `<student-id>/…` — exactly what the storage policy checks |
| `student_semesters.marksheet_id` ever written | Both semesters linked |
| Evidence belonging to the right student | `d.student_id = ss.student_id` → **true** for both |
| The right kind of document | `semester_marksheet` on both |
| The scale surviving honestly | `declared_marks 8.50`, `marks_scale cgpa`, `cgpa 8.50` |
| Row state | `status = pending` — in the coordinator's queue |

**A caution about reading this too early.** The first counts of the session
said `semesters 0, documents 0` and looked like a broken submission. They were
taken *mid-flight*, seconds apart, while the student was still submitting.
**Re-read before concluding anything from a zero.**

**The PDF-only friction is now evidenced, not theoretical.** Every uploaded
file is named `images (N).pdf` — the tester had to convert photographs to PDF
to get them accepted. That is §1 item 2, and a real student will not do it.

### The next thing to prove, and it is one screen away

Nobody has **verified** that submission. `/cpc/verification` should now show
the two declared semesters, each beside a signed link to its marksheet. Open
it as the campus CPC, click a link, approve. That closes the loop
SRF → evidence → verification → eligibility, and it has never been run
against real data.

---

## 1. 🔴 The immediate next step

Everything built in this session is **shipped**. In order:

0. ~~Get a student through the rebuilt SRF~~ **DONE 2026-08-05, see §1b.**
   The submission half of the chain is proven live.
1. **Verify that submission as the campus CPC.** `/cpc/verification` now has a
   real row in it for the first time: two semesters, each with a signed
   marksheet link. Open it, follow a link, approve. Then the student becomes
   `srf_approved` and R5 has a **verified** semester to read — which is the
   first time eligibility will run on anything other than the A28 fallback.
2. ⚠️ **Marksheet uploads are PDF-only** (`UPLOAD_ACCEPT` in
   `src/components/form.tsx`), and the `marksheets` bucket accepts
   pdf/jpeg/png. PRD §21.2 says students are primarily on **phones**, where a
   marksheet is photographed, not scanned — and an iPhone photo is HEIC, which
   neither allows. These uploads are now **mandatory**, so this stops being
   theoretical the moment a student tries. Decide deliberately: widen the
   accept list (and the bucket) to jpeg/png/heic, or tell students to convert.
   Not changed here because it is a product decision, not a defect.
3. **No KAM or ER profile exists yet**, so `0018` is correct-but-unexercised in
   production. The first KAM invitation is the real test: assign campuses on
   the Staff screen and confirm they see those students and no others.
4. **Playwright journeys for the other roles.** The student journey is the only
   one, and it is the only thing that proves the wiring.
5. **Result corrections** (A15) and the notifications UI (blocked on P1).

---

## 2w. One marks scale per degree; optional diploma/UG evidence (`0026`, shipped)

Asked for 2026-08-06. Five changes; two of them reverse earlier rules.

| Change | Note |
|---|---|
| **One scale for the whole degree**, chosen right after the UG/PG question | "The metric will not change semester to semester" |
| **Scale before marks** (diploma and UG) | The scale tells the student what the box below expects |
| "Diploma/UG result" → **"Diploma/UG marks"** | |
| **Diploma + consolidated UG marksheets are now OPTIONAL** | Reverses part of A31 |
| Percentage option reads **"Cumulative percentage (%)"** | |

### Why (1) was worth more than a click saved

Asking per semester gave eight chances to answer inconsistently, and
eligibility would then compare figures **that were never on the same scale** —
semester 3 read as a CGPA and semester 4 as a percentage, with nothing to flag
it. `student_semesters.marks_scale` is still written on every row, so a stored
figure always says what it means; the form simply cannot produce a mixture.

### Why relaxing the evidence rule is safe

**Neither relaxed figure feeds an eligibility cutoff.** R5 reads the latest
*verified semester*, and `student_semesters.marksheet_id` is **still NOT
NULL** — the evidence that decides who may apply to a drive is untouched.
`0026` still requires the pair that makes a diploma number readable: a figure
with no scale is meaningless, because 78.5 is a fine percentage and an
impossible CGPA.

⚠️ **The trade-off a coordinator inherits:** a diploma mark or a PG student's
UG aggregate may now arrive with nothing to check it against. Both are shown
in the verification queue as declared; neither can be *verified*.

### A real bug fell out of this, caught by an existing test

`storeMarksheets` iterated `requiredMarksheets`. The moment those two slots
stopped being required, a diploma or UG marksheet the student **had** uploaded
would have been silently discarded — precisely the defect this whole area was
built to fix. It now iterates every offered slot: `marksheetSlots()` returns
them all with a `required` flag and `requiredMarksheets()` is that list
filtered, so the two cannot drift.

**Label collisions keep biting.** "UG marks" is a substring of "Consolidated UG
marksheet"; the test uses a negative lookahead `/ug marks(?!heet)/i`. Earlier
the same trap hit "Semester 1 marks" vs "Semester 1 marksheet".

---

## 2x. Other professional profiles (`0025`, shipped)

"In professional profiles, have field to enter others also. they can add
fields, give a name and mention the url/user name" (2026-08-06).

The form hard-coded LinkedIn, GitHub, LeetCode and HackerRank. A Kaggle
profile, a Behance portfolio, a Codeforces handle or a personal site had
nowhere to go — often the strongest evidence a student has.

**The value is deliberately NOT validated as a URL.** "url/user name" is the
load-bearing half of that sentence: a Codeforces handle is not a URL, and
demanding one would refuse exactly the entries the field exists to capture.

Rules in `src/domain/profile-links.ts` — they are about what makes a profile
useful to the person reading it, not form plumbing:

- both halves or neither, with the error naming the **entry** ("Add the link or
  username for Kaggle"), not the row number
- a row added and left blank is **dropped**, never held against the student;
  a **half**-filled row is kept so validation can point at it
- duplicate names refused case-insensitively — two "Portfolio" entries are
  indistinguishable to a recruiter
- capped at 8 (A34)

Stored as `students.other_profiles` jsonb, not a child table: display-only
links with no independent lifecycle, and every new table is another chance to
get RLS wrong. Existing student policies cover it; the audit trigger already
records before/after. Postgres guarantees only that it is a list.

Uses `useFieldArray`, not an array index as the React key — removing the second
profile would otherwise carry its input state onto the third.

---

## 2y. The SRF academic section, rebuilt (`1150c2d`, shipped)

Asked for over two messages on 2026-08-06. Five changes, one section.

| # | Change | Why it mattered |
|---|---|---|
| 1 | **Uploads sit beside the figure they evidence**; seven sections are now six | A student entered a mark in one section and hunted for its document in another. That is also how a marksheet ends up filed against the wrong semester |
| 2 | **The school that issued each figure** | A coordinator verifying a marksheet had no institution name to check the letterhead against |
| 3 | **Diploma** — optional to declare, all-or-nothing once begun | It did not exist at all, and it is the route most polytechnic students take into an engineering degree |
| 4 | **The UG/PG fork moves up**, and a PG student records the degree they finished (degree, college, branch, result, marksheet) | Everything below the fork means something different depending on the answer. The old bare aggregate CGPA told a recruiter nothing about where it was earned or in what |
| 5 | **CGPA *or* percentage**, chosen per figure | Not cosmetic — see below |

### (5) is the one to understand

78 is a fine percentage and a nonsense CGPA. A student at a percentage-scale
college had two options: mistype it as 7.8 — wrong by a fifth of a grade, and
**it decides eligibility** — or be refused outright by the 0..10 check.

**Both figures are stored, deliberately:**

- `cgpa` — normalised to 10 points. The only thing a cutoff can be compared
  against, and what every existing reader already assumes.
- `declared_marks` + `marks_scale` — what the student typed. What a coordinator
  finds on the marksheet, because a converted CGPA is **not printed on it**.

The conversion is **one constant** in `src/domain/marks.ts` and nowhere else,
because it decides who may apply to a drive. ⚠️ **A33: the divisor 9.5 is an
ASSUMPTION.** Other universities use `(CGPA − 0.75) × 10`; 80% is 8.42 under
one and 8.75 under the other, and at a cutoff of 8.5 the same student lands on
opposite sides. **Confirm this with the client.** Changing it is one constant
plus a backfill of `cgpa` from `declared_marks`.

### Traps hit while building this

- **A label containing another label breaks `getByLabelText`.** "Semester 1
  marks" is a substring of "Semester 1 marksheet", and "Semester 1 marks scale"
  contains both. The field is now "Semester 1 result", which also reads
  correctly for either scale.
- **`Field` appends `*` and `(required)` to the accessible name**, so a
  `$`-anchored label regex can never match a required field. Do not anchor.
- **Never use `perl -0pi -e` with `$/` in the replacement.** It interpolates as
  the input record separator and silently writes NUL bytes into the file; the
  only symptom is grep reporting "binary file matches".

---

## 2z. What was built on 2026-08-06 — marksheet evidence (`5be9700`, shipped)

**The SRF collected the marksheets and threw them away.**

The uploads were marked required, the student picked their files, and every one
was discarded: the `FileField`s had no handler that kept the file, only one
that flipped a boolean for the progress bar. No storage object, no
`student_documents` row, and `student_semesters.marksheet_id` — created in
`0003` for exactly this — **was never written by anything**.

So the coordinator's verification queue showed a declared CGPA with nothing to
check it against, which is the entire point of verification. "Approve" meant
endorsing the student's own typing. **That is load-bearing:** R5 reads the
latest *verified* semester to decide whether a student may apply to a drive, so
the hole sat precisely where a business rule depends on it.

| Layer | What |
|---|---|
| 0 | `src/domain/marksheets.ts` (new, 100%). `requiredMarksheets()` derives the required evidence from what the student **declared**; one shared key derivation so a file can never be stored under one name and looked for under another |
| 0 | `srf-progress`: the section was complete after **any one** file. Now needs every required one, so declaring another semester correctly re-opens it |
| 0 | `srf-draft`: uploads are **never** restored from a draft. A `File` stringifies to `{}`, so a restored draft would have counted evidence that was gone |
| 1 | Files are part of the submission and validated per slot; the missing one is named **on the field that is empty** |
| 1 | The semester marksheet list was driven by its **own** counter with its own "add another semester" button — the form opened asking for two semester marksheets while the academic record had one line. It now follows the declared record |
| 1 | The repository uploads → records → links, and stores evidence **before** the form enters the queue |
| 1 | The queue shows each declared semester with its CGPA, arrears and a signed marksheet link — or says "No marksheet" rather than a dead link |
| 2 | `0023`: `marksheet_id` **NOT NULL**, plus two triggers |

### Things worth knowing

- **The foreign key never said *whose*.** `marksheet_id references
  student_documents(id)` allowed one student's marksheet to evidence another's
  CGPA, or a résumé to. Both are now refused by trigger, proved as a real user.
- **No test had ever proved a student can insert their own
  `student_documents` row.** Every fixture wrote documents as the superuser,
  which bypasses RLS. The policy was fine; the coverage was not. `seed()` does
  **not** set `auth_user_id` — a student claims their row by inserting into
  `auth.users` with their rostered email. Do that, or your "as the student"
  test proves nothing.
- **`toMatchObject({ marksheets: {} })` matches any object.** A test written
  after its code passed against the broken version. Mutation-checking caught
  it; `toEqual` fixed it. Two tests here were written after their code and both
  were mutation-checked — do that, or say so.
- Ordering is a correctness rule: uploading after the status flip would ask a
  coordinator to verify against documents that do not exist.

---

## 2a. What was built on 2026-08-05

**Both dashboards that §1 asked for, and the RLS defect that blocked them.**

| Commit | What |
|---|---|
| `0f4911f` | **Campus scoping finished** (`0018`) |
| `dfd8d44` | **Student dashboard on real data** |
| `971dbd3` | **Drive portfolio for the Delivery Head and the AE** (`0019`) |
| `8751800` | Open-drive count now runs R5 instead of counting live drives |
| `c31c0b7` | Tests for the shared reporting view; assumptions recorded |
| `bface80` | **Shipped:** `0018`/`0019` to Mumbai, app to Cloudflare |
| `36ceec7` | Cockpit, final-selection and participation-queue views covered |
| `01a0645` | The last five untested views covered — **`pnpm check` green** |
| `3c11891` | **Analytics domain rules**: CTC, funnel, drive clock, `math.ts` |
| `f27202b` | Registration funnel + package figures on the shared dashboard |
| `9b1d5d3` | **Drive targeting enforced** — it was recorded and never read |
| `2a26a06` | Live drive figures: time left, eligible vs applied, offers |
| `344d424` | The overview given to every relevant stakeholder |

### Stakeholder dashboards (2026-08-05, shipped)

Asked for: *"total registered students to number of students placed to CTC
details … live drive data like drives completed, number of offers got in
drives, open drives time left, number of eligible to applied students … for all
relevant stakeholders."*

Built on the **one** shared dashboard rather than as a sixth variant, so no two
roles can be shown different arithmetic. RLS decides what each of them sees.

| Panel | Rule behind it |
|---|---|
| Registration funnel — roster → submitted → verified → applied → placed | `registrationFunnel`, computed cumulatively so it can never widen as it descends |
| Package — highest / average / median / lowest, and per ladder rung | `summariseCtc`, fed **one figure per placed student** via `resolvePlacementRecord` (R9) |
| Open drives — time left, applied of eligible, offers | `applicationWindow` + `driveOutcome`, with `now` passed in |
| Drives completed | `drivesByStatus` |

Who has it now: CEO, ER, ER Head, Campus Manager, KAM, Delivery Head, Admin,
**campus CPC** and **Central CPC**. The **AE is deliberately excluded** — they
have no read policy on `students`, so it would render zeroes and look broken.
Their drives are their view, and those carry the window clock instead.

**A real defect fell out of building it (`9b1d5d3`).** `evaluateEligibility`
documents that an empty criteria list means *any, never none* — and
`drives-view` passed empty arrays for degrees, branches, campuses and cities
because it never loaded the three link tables. Every drive the Central CPC
targeted on the publish screen was therefore open to the **entire roster**: a
B.E CSE drive at one campus was visible, and applyable, to a BCA student at
another. The targeting was being written and read by nothing. Now enforced,
with six regression tests.

### The coverage gate, closed

It had been red for longer than this session — proved against a clean
`f12bb6d` worktree before touching anything: statements 76.68%, branches
62.08%, functions 76.53%, lines 77.62%. Now **90.50 / 80.22 / 90.05 / 91.54**.

What closed it was testing the eight `*-view.ts` files that had never been
exercised at all. They are the layer where a wrong query silently returns wrong
data to a coordinator, so this was worth doing for its own sake, not for the
number. `src/lib/mock-data.ts` also went — 379 lines of mock-era fixtures with
zero importers.

**These tests were written against code that already existed, so none of them
could fail first.** Each file was therefore mutation-checked instead: 21
deliberate breakages, every one caught, and four tests strengthened when the
first attempt let a mutation through. Two of the mutations found real problems:
`publish-view` had no actor seam (its publish path could only run against a
live browser session), and one of my own assertions was simply wrong about the
domain — an opted-out student *may* record a self-placement (PRD §16.2).

**If you add a `*-view.ts`, test it in the same sitting.** The gate is green
now and every commit from here should keep it there.

### The RLS fix — answers the question §7 was blocked on

**Confirmed by the user: "a key account manager takes care of a few campuses;
campuses have to be mapped to a key account manager."** So a KAM is
campus-scoped. `staff_campus_assignments` already held the mapping and
`requiresCampusAssignment()` already collected it at invitation time — no
policy ever read it, so a KAM could read **zero** students.

Fixing that exposed the bigger hole. `students` was campus-filtered;
`applications`, `offers`, `student_documents` and `student_semesters` were
**not**, so any campus role could read every row in all four — and an
application carries `profile_snapshot`, a frozen copy of the entire profile.
Campus-scoping the student row while leaving the application open scoped
nothing.

`0018` now separates reading from writing:

- `is_campus_reader()` — CPC, Campus Manager, **KAM** → select, campus-scoped
- `is_campus_staff()` — CPC, Campus Manager → write, campus-scoped
- `my_student_ids()` scopes all four tables plus self-placement requests
- **A29:** `enterprise_relations` reads organisation-wide, mirroring `er_head`
- **A30:** the AE who *raised* a drive may read its applications, shortlist and
  offers — that drive only, select-only (`0019`)

All of it is proved as a real user in `src/db/campus-scope.test.ts` (21 tests).

### (a) The student dashboard — `/student`

Was hardcoded JSX: *"Welcome back, Priya"*, a fabricated Freshworks offer, a
"Download offer letter" button that downloaded nothing.

Now `StudentDashboardView` + `createSupabaseStudentDashboardView` + a route
wrapper. Their own identity, SRF state, semester record, applications with
every round of the drive, offers, and absences against `ABSENCE_LIMIT`.

New domain rules in `src/domain/student-progress.ts` (100% covered):
- `applicationProgress()` — offer > rejection > waitlist/hold > cleared
  everything > current round > applied. "Cleared every round but no offer yet"
  is its own state; saying "Round 3 of 3" there would be a lie.
- `studentPrompt()` — the one thing to do next. Participation is asked *before*
  the SRF, so an opted-out student is never nagged to finish a form.

Rounds are keyed by **application id**, so no student is ever shown another's
result. `openDrives` runs R5 through `drives-view`, so "3 drives are open to
you" means three they can actually apply to.

### (b) The Delivery Head / AE portfolio — `/my-drives`

Requested 2026-08-04: *"all drives they have raised/approved, applicants to the
drive, the progress of the drives"*. Approving a PIF used to be the last a
Delivery Head saw of it.

One screen for both roles, filtered by raised / approved / all. Per drive: the
lifecycle phase and a progress bar, rounds decided out of total, an on-hold
flag, a five-stage funnel, and an applicant list on demand.

New domain rules in `src/domain/drive-portfolio.ts` (100% covered):
- `involvementIn()` — every hat one person wore, in pipeline order
- `driveProgress()` — position on the pipeline. A **rejected** drive comes off
  it rather than reading "14% done"
- `summariseFunnel()` — counted with the *same* `applicationProgress` the
  student sees, so the two screens cannot disagree about one applicant

Applicants are named from `profile_snapshot`, never the live student row (PRD
§7.3) — which is also the only reason an AE, who cannot read `students`, can
see who applied.

---

## 2. What changed in the 2026-08-04 session (11 commits, 614 → 949 tests)

| Commit | What |
|---|---|
| `827839c` | **Playwright harness** + the student journey (first E2E) |
| `09f606a` | PIF failures now say *why*, instead of "please try again" |
| `40c639c` | Staff **role change + removal** (`0015`) |
| `c195bd2` | **Sign out** — there was none, anywhere |
| `a9df678` | **Invitation for an existing account** (`0016`) — the "new admin can't log in" bug |
| `fa3e41f` | Publish screen against the **real** drive and roster |
| `71a7406` | **Application window + rounds** editor at publish time |
| `801ac5c` | Mandatory alternate contact; upload limits shown |
| `4e56ddd` | **Semester-wise academics** (`0017`) + eligibility on latest VERIFIED |
| `f12bb6d` | SRF semester entry; identity prefilled from the roster |

---

## 3. Confirmed decisions — later answers override earlier ones

**Added 2026-08-05:**

| # | Decision |
|---|---|
| **KAM scope** | A Key Account Manager **looks after a few campuses**, and campuses are **mapped** to them. Campus-scoped, and **read-only**: a KAM does not verify marksheets or mark attendance |
| **DH / AE** | Both get `/my-drives` — their own drives, the applicants, and the progress. The Delivery Head also gets the placement overview they had no link to |

Unchanged decisions are in `git log` and `docs/ASSUMPTIONS.md`. **Changed or
added on 2026-08-04:**

| # | Decision |
|---|---|
| **Academics** | **Semester-wise.** Student declares UG or PG. UG: one line per semester, max **10**. PG: one aggregate line for the completed UG (`students.ug_aggregate_cgpa`), then max **4** PG lines. Each line = CGPA (*not* GPA) + standing arrears + history of arrears |
| **Eligibility CGPA** | ~~Overall CGPA~~ → the **latest VERIFIED semester**. An unverified line never decides eligibility: students type their own marks. Falls back to `students.overall_cgpa` while nothing is verified (A28) |
| **Staff removal** | ~~Deactivate only~~ → an Admin may **change a role** and **remove** a staff member (A25). Removal is refused by FK when their work is still referenced; the UI then says "deactivate instead" |
| **Last Admin** | Nobody may change their own role, remove their own account, or demote/remove the **last active Admin**. A deactivated Admin is not cover (A26) |
| **Drive cockpit** | Also available to `delivery_head` and `account_executive` |
| **Window + rounds** | Set by the Central CPC **at publish time** (A24), on the publish screen |
| **Forms** | Mandatory fields are called out **accessibly**, not just in red. A failed field shows **why**, tied to the control. A missing upload is marked on that upload |
| **Master resume + AI** | **Phase 2.** Confirmed deferred |

---

## 4. Things that will bite you if you don't know them

- **`pnpm supabase db query "<sql>" --linked` works** and needs no DB password.
  It is how the last three bugs were diagnosed — read the live database rather
  than guessing. Read-only queries are safe; it is the production project.
- **`pnpm test:run` is NOT enough before committing.** Vitest does not
  typecheck. Run `pnpm check` (biome + tsc + coverage).
- **Do not `git checkout <file>` with uncommitted work in it.** I did this
  mid-session and destroyed ~7 tests I had just written. Commit first.
- **PGlite runs as superuser, so it bypasses RLS.** A schema test passing does
  not prove a policy works for a real user — use `t.asUser(...)`.
- **`cmd | grep` returns GREP's exit code.** `pnpm test:run | grep Tests && git commit`
  will happily commit a red suite — it did, on 2026-08-05. Redirect to a file
  and check `$?`, or use `set -o pipefail`.
- **The suite is capped at 4 workers** (`vitest.config.ts`). Thirteen files
  start a PostgreSQL in WASM; one worker per core drove the 8GB machine into
  memory pressure and jsdom tests stalled past their timeout. Uncapping it
  brings the flakiness straight back — and capping made the run *faster*.
- **A missing asset path returns `index.html` with HTTP 200.** Verifying a
  deploy with `curl .../assets/<wrong-name>.js | grep -c` therefore reports 0
  for everything and looks like a broken deploy. Read the asset name out of the
  live `index.html` each time, and check the size or hash.
- **`git checkout <file>` will eat uncommitted work** — the warning below is
  there because it happened again on 2026-08-05, to `dashboard-view.ts`, during
  a mutation check. Back the file up *before* mutating, restore from the
  backup, and never let `git checkout` near it.
- **`pnpm supabase db query --linked` fails intermittently** with
  `FATAL: password authentication failed for user "cli_login_postgres"`. It is
  transient — the CLI provisions a temp role each time. Wait a few seconds and
  re-run; it is not a credentials problem and needs no `SUPABASE_DB_PASSWORD`.
- **A count query is a `HEAD` request.** `select(..., { head: true })` is not
  matched by an `http.get` handler, and MSW's unhandled-request error surfaces
  as a 5-second test timeout, not as a failure that names the cause.
- **Nested `aria-label`s collide.** `getByRole("region", { name: /zoho/i })`
  matched both a drive and its applicant list. A string name matches exactly;
  a regex does not.
- **MSW is `onUnhandledRequest: "error"`.** Adding a write to a repository
  breaks every existing test that stubs only the old call. Add the new
  handler to the shared helper, not to each test.
- **Zod object-level `.refine()` only runs once every field parses.** Cross-field
  errors (arrears, missing resumes) only surface on an otherwise-valid form.
- **`datetime-local` is wall-clock in the browser's zone** (Asia/Kolkata). Never
  assert a literal string in tests — assert the instant round-trips.
- **`src/domain` must import nothing**; **no feature may import another**. Both
  enforced by `src/architecture.test.ts`.
- Postgres enums and `src/domain/types.ts` must stay identical — `types-drift.test.ts`.

---

## 5. Live database state (re-checked 2026-08-06)

```
students 3 · drives 1 · staff 5 · student_semesters 0
applications 0 · offers 0 · self_placement_requests 1
student_documents 0          ← nothing has EVER been uploaded in production
```

SRF status: **1 `registered`, 2 `invited`** — nobody has submitted the form
since the fix that made submitting possible at all (`0020`). That is the single
most valuable thing to prove next; see §1.

- All 3 students are `BCA / AI and DS / 2027`. The publish screen correctly
  shows **0 of 3** eligible, all excluded as *"SRF not yet verified"*. Not a bug.
- The one drive is **TCS, `approved`**, with **no application window and no
  rounds** — it cannot go live until someone sets them on `/central/publish`.
- **The one self-placement request is `FACE, ₹4.00 LPA, pending, with no offer
  letter.`** It predates `0022`, which is why both constraints are `NOT VALID`.
  A coordinator should ask that student for their letter or reject it — the
  screen now shows "No offer letter was uploaded with this request".
- `thanush@faceprep.in` has an `auth.users` row but **no invitation and no
  profile** — a ghost from a removal. Re-invite them from the Staff page and
  `0016` will materialise the profile immediately.
- Nobody has a verified semester, so eligibility runs on the **A28 fallback**.

---

## 6. Not built yet

**Screens missing, rules and repositories present:**
- ~~Student dashboard on real data~~ **built 2026-08-05**
- ~~Delivery Head / AE dashboards~~ **built 2026-08-05**
- ~~Per-semester **marksheet** uploads tied to their semester row~~ **built and
  shipped 2026-08-06** (`0023`) — the files were being collected and discarded
- Recruiter export UI + XLSX/ZIP (`buildRecruiterExport` is done) — **needs a
  dependency decision (P2)**

**Not started:**
- Notifications UI and the pgmq queue — **no email provider chosen (P1)**
- Result corrections
- Playwright journeys for every role except student
- Compliance module (Phase 2)

---

## 7. Still outstanding from the user

See `docs/PENDING-USER-ACTION.md`. Live blockers:

| # | Needed |
|---|---|
| **P1** | **Transactional email provider** + key. Gmail's ~2,000/day cap with no delivery webhooks does not meet PRD §21.2 |
| **P2** | Approve a spreadsheet library (SheetJS/ExcelJS) for `.xlsx` roster import and the recruiter export |
| **P3** | The skill-repository score schema (R11 ranking is invented — A12) |
| **P7** | Google OAuth verification if >100 users are expected |
| **new** | A27: a PG student's UG aggregate is stored as **CGPA on the 10-point scale**, not a percentage. Cheap to reverse now |

---

## 8. First commands in a new session

```bash
cd ~/fpc-pms
export PATH="$HOME/.npm-global/bin:$PATH"   # pnpm lives here
pnpm install
pnpm test:run        # expect 1556 passing across 107 files
pnpm test:e2e        # expect 1 journey passing
pnpm dev             # localhost:5173
```

Ship with `pnpm db:push` (migrations) then `pnpm deploy` (Cloudflare). Both were
run this session and both succeeded; **neither is automatic** — committing does
not deploy. `pnpm supabase migration list --linked` is how you check.

Git is **local only**, no remote. 93 commits, working tree clean.
