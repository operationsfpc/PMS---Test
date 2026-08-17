# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
**2936 tests passing across 152 files**, plus **1 Playwright journey** — run,
not remembered. **`pnpm check` exits 0** — lint, typecheck and every coverage
gate. Remote is at **`0048`** (0048 pushed 2026-08-18); live Cloudflare
version `89409f04-5f55-4179-a8e6-65dbab4a9393`. Commit hash deliberately not
quoted here: it has been wrong three times, always because it was written
before the commit existed. Use `git log --oneline -5`.

---

## ✅ SHIPPED 2026-08-18 — boards, the reject button nobody had, three drive tabs

Live `89409f04-5f55-4179-a8e6-65dbab4a9393`, JS byte-identical to `dist/`
(880 709 bytes, sha256 `fe9b3f35…`). Remote migrations at **`0048`**.
`pnpm check` exits 0 — **2936 tests / 152 files**. Spec:
`docs/specs/2026-08-18-srf-boards-rejection-and-drives-nav.md` (✅ APPROVED,
answers 1a · 2 required · 3 state named · 4 "University / Board" · 5 yes ·
6a · 7 yes · 8–10 as recommended).

### 🔴 The rejection half of PRD §4.2 has never worked, in two ways at once

1. **No screen offered Reject.** `decideSrf` has refused empty reasons for
   weeks, `srf_rejection_reason` has existed since 0003, and 0020 has permitted
   the student's `srf_rejected → srf_submitted` — and `/cpc/verification` still
   showed **only Approve**. A rule with no control on any screen is a rule
   nobody can follow. There is now "Send back for changes" with a required
   comment, campus CPC only (0042 already refuses everyone else in the database).
2. **A rejected form reopened BLANK.** `submit_srf` sets `srf_draft = null`, and
   the page merged roster identity + draft only. So to correct one line a
   student retyped thirty from memory — and a figure retyped from memory is a
   figure that can be mistyped, so the coordinator would then be checking a NEW
   error. `srfValuesFromSubmitted` (domain) now prefills from what was
   submitted; a real draft still wins (it is newer); the uploads are the one
   thing that must be re-attached, and the form says so in a line of its own.

The student is also told: `0048` writes a notification (not to an opted-out
student — D7's rule), and the coordinator's own words now appear on the
dashboard prompt. A resubmission carries a **Resubmitted** badge and repeats
what was asked for, so the same defect is not missed twice.

### School boards, and who awarded a diploma

`src/domain/boards.ts` owns the vocabulary (7 boards), the 36 states/UTs, and
the two rules that make an answer coherent: a State Board names its state,
Other is named. `0048` refuses the same pairs in SQL, **in both directions** —
a state stored against CBSE would be shown to a coordinator beside the marksheet
and read as a fact.

💡 **ONE enum value for CISCE, two labels** — ICSE at class 10, ISC at class 12.
Two values would let a student record "ISC" against their tenth and nothing
downstream could tell that apart from a real answer.

Columns are **nullable and not backfilled**: three students are already
approved, and an invented board is a claim nobody checked. `describeBoard(null)`
reads "Not recorded".

🔴 **One missing field took the whole verification queue down.** Adding
`tenthBoard` to the queue's row type made `describeBoard(undefined)` throw, and
the screen rendered as `<div />` — not an error, just nothing. It now reads
"Not recorded" for a nullish selection, with a test that says why. **Anything
rendered once per row must survive a field that is not there yet.**

### The marks-scale question now names its college (6a)

"How your college reports marks" governs the semester lines, which for a PG
student are **PG** semesters. It reads **"How does your PG college report
marks?"** on PG, and the completed-UG block's bare "UG scale" is now **"How does
your UG college report marks?"**. This is a **deliberate deviation from the
literal request** ("add the word UG in the question"), agreed at approval as 6a:
labelling the PG semester scale "UG" would collect a percentage as a CGPA and
change who is eligible for a drive. Reverting is one string plus one test.

### Drives: three tabs, no chips, and a search box

`Yet to publish` (**approved only** — Yet to publish keeps the cockpit, because
it carries the publish action) · `Live` · `Completed`. Drafts are gone from the
Central CPC as asked. `/central/drives` and `/central/drives/published` still
answer, pointing at Live.

**⚠️ A39 — UNCONFIRMED.** `submitted` and `rejected` drives now appear on **no**
Central CPC screen. That follows from 0047 (raise = AE, approve = DH, publish =
Central CPC), and reversing it is one entry in `DRIVE_TAB_STATUSES`.

The three chips (All my drives · Raised by me · Approved by me) are **removed** —
they filtered a list to itself, since every drive an AE can see is one they
raised. A **search box** replaced them (`searchDrives`: every term must match,
company and role), which is what a growing list actually needs.

### 🔜 NEXT SESSION STARTS HERE

**`docs/specs/2026-08-18-click-to-see-everything.md` — 7 items, 8 questions,
AWAITING APPROVAL.** It consolidates everything asked after this shipped, and
supersedes `2026-08-17-drive-details-for-central-cpc.md`:

N1 click-through to a full record everywhere (one canonical `/drives/:id`) ·
N2 the same Drives sidebar for every staff role · N3 an "Open now" box on the
application window · N4 **10th/12th targeting — must land in the RLS apply gate
too, or the audience count and the gate disagree** · N5 the PIF's rounds
materialise as the drive's rounds · N6 search on campus Drive progress ·
N7 the student's four lists (to apply / in progress / not applied / closed).

🔴 **P10, found while building, nobody's report: the SRF's role preferences and
resumes are never stored.** `student_role_preferences` has been empty since
0003 and the resume `File`s are discarded after ticking a box — so R7's "one
resume per role category" is fed only by `/student/profile`, and a student who
has only filled in the SRF has no resume on file at all, while `rankApplicants`
scores role-preference match. It needs its own decision; it is written up at
the end of that spec.

---

## ✅ SHIPPED 2026-08-17 (later) — one verb, one role

Live `478ec77f-b1f8-4c8d-9153-d62222b0a425`, JS byte-identical to `dist/`
(866 850 bytes, sha256 `ed230af0…`). Remote migrations at **0047**.

### The drive lifecycle now has three roles and no overlaps

    raise -> account_executive    approve -> delivery_head    publish -> central_cpc

**0008 handed out `for all` on `drives` twice** — to `delivery_head` and to
`is_operator()` (admin + Central CPC). `for all` includes INSERT, so both of
the people whose job is to *check* the AE could raise a drive of their own and
then approve or publish it themselves. The UI never offered it. The database
allowed it. **0047** splits those grants into `update` + `delete` and gives
INSERT to the AE alone.

**A second hole surfaced while writing the test.** 0008 checked no status on
INSERT and 0009's transition guard only fires on UPDATE — so an AE could insert
a drive already `approved` or `live` and step past both other roles in one
statement. INSERT is now confined to `draft` and `submitted`.

`/ae/pif` and `/delivery-head/pif-approvals` were open to anyone signed in.
Both refuse at the door now.

**⚠️ The contradiction in the request, and how it was read.** Karthik wrote
"Only Central PC can approve it" one sentence before "Central PC cannot raise
or approve a drive". Read against the same day's "only the Central Placement
Coordinator is authorized to publish it", the first is a slip for **publish** —
the only reading under which all three sentences agree. That reading is
implemented and flagged at `src/domain/drive-portfolio.test.ts`. **Confirm it.**

### Also shipped

- The match score (the "15") is gone from the shortlisting screen. Still
  calculated — it orders the list — and still saved with the decision, because
  PRD 13.1 wants the recommendation kept beside the choice.
- `(R9)` removed from the Package copy. `src/copy.test.ts` now **fails the
  build** on any `(R9)`/`(D10)`/`(§12.3)` reaching a screen.
- Sidebar: "Publish a drive" → **"Student details"** (All students · Skill
  repository). "Publish and target" was a dead entry — it needs a drive id, so
  from the sidebar it only ever said "choose a drive from the drive cockpit".
- **New:** `/central/students` — every student in the placement process, with
  filters, search and CSV export. The Placed count on the overview links
  straight to `?filter=placed`.

### Also shipped: Add students

`/admin/roster` is now **"Add students"** (was "Import student roster"), with a
**downloadable header-row template**. The importer refuses a file whose columns
are not in the exact expected order, so retyping the header by hand was a
failed import waiting to happen. The template is generated from
`ROSTER_COLUMNS` and a test uploads it back through the parser, so it cannot
drift. Headings only — an example row would get imported by whoever forgot to
delete it.

### 🔜 NEXT SESSION STARTS HERE — the overview boxes are half-built

`src/domain/placement-metrics.ts` is **written and green (29 tests)** but **not
yet wired to any screen**. It computes exactly what Karthik specified:

- Row 1 — registered · eligible (60% bar) · unique placed · placement offers ·
  unique interns · internship offers
- Row 2 — drives completed / in progress, placement and internship separately
- `internship_convertible` counts as a **placement**, never an internship

Still to do: the two-row layout, moving the campus selector to the right and
shrinking it, and making each box open the list behind its number.

**✅ A34 CONFIRMED 2026-08-17:** "6.0 CGPA or 60% in marks is fine." The bar is
settled; `CGPA_BAR` stays at 6.0.

**✅ "Registered" CONFIRMED:** "students whose addition to the portal has been
approved" — so it is **every student on the portal**, not the registration
form. Only an Admin can add one, and the addition is the approval.

**✅ The publish/approve contradiction CONFIRMED:** "your assumption about
Central PC can only publish is correct."

Good news on the data: `programme_level` and `ug_aggregate_cgpa` already exist,
so "post-graduation as well if applicable" is genuinely computable — a PG
student is held to four marks, an undergraduate to three.

---

## ✅ SHIPPED 2026-08-17 — the mystery "15", AE read-only, CTC bands on screen

Three items from Karthik. **Front end only — no migration.** Live version
`94708890-667e-43c9-a726-306b39b6f669`, JS byte-identical to the local `dist/`
(857 072 bytes, sha256 `128d2e77…`).

### 1. The number 15 was the match score, wearing no label

*"What is the number 15? I see that in a lot of places while shortlisting
students. It is not clickable. It is not referring to anything else."*

It was `rankApplicants`' weighted score (`src/domain/ranking.ts`), printed as a
bare numeral in the right-hand corner of every shortlisting row. Karthik's test
student had CGPA 0, no skill scores and had not listed the role category — so
the only points scored were the 15 for having no arrears. The arithmetic was
never wrong; the screen simply never said what the number was or what it was
out of, and a numeral with no label cannot be told apart from a rank, a count
or an id.

Now a labelled `<figure>`: **"Match score / 15 / 100"**, with the notice above
the list explaining that it weighs CGPA, required skills, arrears and role
preference, and that it is advisory.

**Gotcha for next time:** if a number appears on a screen, it needs a label and
a scale in the same element. This one survived UAT twice.

### 2. The AE could publish and shortlist. They cannot now

*"The AE should only be able to view the students shortlisted or selected or
their drive status and results. They should not be able to publish drives or
shortlist students."*

The **drive cockpit** was in the AE's sidebar. The cockpit is a work queue and
its work is publishing and shortlisting, so offering it offered both. Fixed in
three places, deliberately:

| Layer | Change |
|---|---|
| `src/domain/drive-portfolio.ts` | new `canPublishDrive` — Central CPC only |
| `src/components/app-shell.tsx` | cockpit removed from the AE nav |
| `src/features/central-cpc/cockpit-page.tsx` | both action links gated; `role` is a **required** prop |
| `src/app.tsx` | `ShortlistersOnly` / `PublishersOnly` guard the two routes |

The AE keeps `/my-drives`, which already shows drive status, applicants, who
was shortlisted and who was selected — read-only. The Delivery Head is
excluded from publishing too: approving the commercials is not announcing the
drive.

**`CockpitPage.role` is required, not defaulted.** A permissive default is a
permission granted by forgetfulness. Do not "fix" a type error by defaulting it
back to the Central CPC.

**Still outstanding — server side.** These are UI guards. RLS should refuse an
AE's publish/shortlist writes as well; nothing in this session touched the
database. Worth a pgTAP pass before launch.

### 3. The CTC bands are now stated where the classification is made

`describeOfferCategoryBands` (`src/domain/offer-category.ts`) renders a banner
above the Delivery Head's approval queue: Regular up to ₹5 LPA, Dream above ₹5
and up to ₹10, Super Dream above ₹10. The wording is **derived from the bands**
so retuning them retunes the sentence, and the dropdown's labels now come from
the same `offerCategoryLabel`, so the banner and the control cannot disagree.

**⚠️ Open question for Karthik.** He phrased the top band as *"10L and 10L+ CTC
are Super dream"*. The domain has always treated band edges as belonging to the
**lower** band, so exactly ₹10.00 LPA classifies as **Dream**, and ₹10.01 LPA
as Super Dream. The banner says so explicitly rather than silently adopting
either reading. If ₹10.00 should in fact be Super Dream, `DEFAULT_OFFER_CATEGORY_BANDS.dreamMaxLpa`
goes to `9.99` — one number, one test, no migration.

---

## ✅ SHIPPED 2026-08-13 — publishing targeted 0 students; it targets 2 now

Reported: *"publishing a drive from the Delivery Head login targets 0 eligible
students, even when students fully meet all configured eligibility criteria."*
**Front end only — no migration.** Live version
`a8ef055b-ac0c-4a47-8e5f-ca88ec210b3b`, JS byte-identical to the local `dist/`
(854 404 bytes, sha256 `7634237f…`), `/central/publish` 200.

### The root cause is one this file already describes — on the other screen

The publish screen judged the cohort on **`students.overall_cgpa`, a column the
registration form deliberately never writes** (an overall CGPA is not the
student's to declare). `?? 0` turned that null into a CGPA of **zero**, so any
cutoff at all excluded the whole roster and the coordinator was told "nobody
matches this targeting yet" about students who plainly qualified.

This is exactly the failure of *"approval did not verify the semesters"*
(0031), which predicted it in as many words: *"the next drive that sets a CGPA
cutoff would silently exclude the entire cohort."* 0031 fixed the student's own
drive list and **nobody carried the same mapping across to the publish screen**.
Both now read the latest VERIFIED semester (§7.2) — the same rule the apply
gate enforces, so the audience number is a promise the gate will keep.

**Proved live as a real `delivery_head` through RLS, rolled back** (no such
profile exists today — an existing admin was promoted inside the transaction):

| HCL Technologies, cutoff 7.89 | |
|---|---|
| Targeted **before** | **0** ← the report |
| Targeted **after** | **2** — Shashwathi Test 8.50, Test 9.05 |
| Thanush Krishna 7.50 | correctly still excluded |
| Readable as that delivery head | students 5 · semesters 5 (4 verified) · all three link tables |
| Rows left behind | 0 — role restored to `admin`, re-read after |

The unit test reproduces it: putting the old mapping back yields
`expected [] to deeply equal [ 'Shashwathi Test', 'Test' ]`.

### Found on the way — the screen published criteria nobody approved

Same screen, same write. The cutoff, the arrear policy and the targeting were
all **fetched and thrown away**: the form opened on a hardcoded `7.0`, "no
standing arrears" and every chip clear, and publishing wrote that invention
over the drive. Two consequences, one already in production:

1. **Two live drives lost their declared 7.50** (`min_overall_marks` survives
   beside a null `min_overall_cgpa` — that pair is the fingerprint). Recorded
   as **P9**, not repaired: changing eligibility on an open drive is the
   client's call, and Accenture already has an application against it.
2. 🔴 **Re-publishing a live drive DELETED its link rows** — and an empty link
   table means "any", so the drive silently opened to the whole roster. Nobody
   had done it yet. The chips are seeded now, and a test asserts the seeded
   targeting is what gets published.

The box is left **empty** when a drive declares no cutoff. Inventing one is
what made this recoverable-looking: clearing the box was the only way anyone
ever got a non-zero audience, which is why all four published drives have null
cutoffs.

⚠️ **The reported role does not exist in production.** There is no
`delivery_head` profile at all — 3 admins, 2 Central CPCs, 1 AE, 1 campus CPC
(`ashokkumar091293@gmail.com`, who WAS the delivery head two sessions ago).
The defect is role-independent, so the report stands either way, but
**re-read `profiles` before naming an actor** — this is the third session in
which a role moved underneath a proof.

💡 **The trap that hid this for so long: the test fixture was healthier than
production.** `publish-view.test.ts`'s student carried `overall_cgpa: 8.4`, a
value no real student has ever had. The new tests are shaped like the live
rows — null roster CGPA, verified semesters — and that is the only reason they
fail against the old code.

**Re-verified at the END of the 2026-08-13 session, not remembered:**
`pnpm check` exits 0 (**2511 tests / 144 files**), the Playwright journey
passes, the remote is at **`0045`** (read from
`supabase_migrations.schema_migrations`, unchanged — that session shipped no
migration), the live JS is byte-identical to the local `dist/` (854 404 bytes,
sha256 `7634237f…`), <https://fpc-pms.faceprep.workers.dev> answers 200, and
the working tree is clean at `db7fff0`.

The 2026-08-12 session verified the same way at 2494 tests; it began at `0040`
and shipped `0041`–`0045`.

---

## ✅ SHIPPED 2026-08-12 — the workflow simplification, all four stages

Spec: `docs/specs/2026-08-12-workflow-simplification.md` (✅ APPROVED, D1–D10
recorded verbatim; mockup `2026-08-12-sidebar-mockup.html` approved as-is,
two assumptions corrected at approval and folded in). Interview → spec →
mockup → build, in that order.

### Stage 1 — the ladder blocker (`0041`)

**"Students should only be able to apply to the offer category they're
eligible under" was flagged as a blocker, and it was three defects deep:**

1. `drives-view.ts` selected a **non-existent column** (`offers.status`) —
   PostgREST refused the whole query, the error was swallowed, the ladder
   judged every student never-placed.
2. Even fixed, the raw snake_case rows were blanket-cast to the domain's
   camelCase `Offer` — `driveType`/`source` were `undefined`, so the ladder
   STILL saw nothing. Mapped field by field now, select registered in
   `query-contract.test.ts`.
3. **No server-side gate at all** (`applications_insert_self` checked only
   "own student id"). `0041` adds `enforce_application_gates`: live+window,
   `srf_approved`, active participation, campus targeting, internship cap,
   category ladder; R5a override bypasses ladder+cap only. Proved as a real
   student through RLS — 14 db tests — and against PRODUCTION in rolled-back
   transactions (window refused · draft refused · equal category refused ·
   higher rung ACCEPTED).

**D5 (client-confirmed reversal of PRD §16.2's eligibility half):** a
self-placed offer now climbs the ladder; a self-placed **internship consumes
the cap** (his correction at approval). Reporting stays separate — R9 and the
statistics still exclude self-placed. **D6:** the approving coordinator must
classify a self-placed offer (job/internship + rung); the off-campus queues
gained mandatory selectors; `ladder_offer_has_category` restored to 0006's rule.

🔴 **The push refused the constraint: `offers` was NOT empty.** The spec said
0 rows — read from the Aug-6 handover, not re-checked. UAT had created one
(Thanush, self-placed, ₹3.50 LPA, no category). Backfilled from the R1 bands
(→ `regular`), flagged in `docs/PENDING-USER-ACTION.md` for coordinator
review. **Under D5 that offer now blocks him from regular drives — proved
live.** Re-read production before every irreversible claim; the handover's §5
counts are a snapshot, not a fact.

### Stage 2 — grouped sidebars · publish split · verification narrowed (`0042`)

- **`ROLE_NAVS` is now heads + sub-heads for every role** (D1). `NavGroup`
  rendered as an accessible heading per group.
- **Central CPC's cockpit absorbed** into *Yet to publish* (draft/submitted/
  approved — rejected is nobody's queue) and *Published* (live and later) —
  D2, approved assumption 3. `/central/drives` still answers for old links.
- **D3: verification is the campus CPC's alone.** `0042` refuses SRF
  decisions (trigger, names the rule) and certificate decisions (policy —
  RLS filters silently) for everyone else, admin included. Nav entries gone
  from the Central CPC; `/cpc/verification` and `/cpc/certificates` refuse
  other roles at the door. **Proved live as the real central CPC (refused)
  and the real campus CPC (accepted), rolled back.**
  ⚠️ Accepted consequence: an empty campus-CPC seat halts verification.
  Client keeps the seat filled (currently `ashokkumar091293@gmail.com`,
  campus-mapped, not on the roster — verified live).

### Stage 3 — the shortlist reaches the student (`0043`)

**"Data not reflecting in panel / to student" root cause: nothing connected
the shortlist to Round 1**, so the results screen (reads `attendance`) and
the student dashboard read empty tables.

🔴 **And the round tables had NO RLS AT ALL** — `round_participants`,
`round_results`, `attendance`, `recruiter_exports`, `email_deliveries`,
while 0008 grants insert/update to `authenticated`: any student could write
themselves a `selected` result. Same class as 0030's invisible-drives hole.
`0043` locks them: students read their own, staff by scope, the drive's AE
reads theirs (0019's argument), operators write, campus CPC also writes
attendance.

The cycle, all by `security definer` triggers (postgres has `rolbypassrls`,
same mechanism as the audit trigger):

| Event | What happens |
|---|---|
| shortlist `included` → true | Round 1 scheduled (`round_participants` + `attendance`), notification "You are shortlisted for {company}" |
| → false | untouched Round-1 slot taken back; anything marked or decided stays; the notification stays (it WAS sent) |
| result `selected` / `rejected` | notification, naming the round — **rejected notifies too** (client's correction). Waitlisted/on-hold: quiet (A38) |
| offer insert (on-campus) | notification. Self-placed is the student's own news |
| opted-out student | **never notified**, and cannot be `included` without an override reason (D7) — column + trigger |

UI: shortlist page shows the opt-out alert + per-student override with a
reason (carried to the row); the save button says it notifies and schedules;
**`DriveRoundsPage`** — numbered round tabs, add-a-round (unique key on
(drive_id, sequence) settles races), explicit **"Advance N selected to Round
N+1"**; student dashboard gained the notifications panel (unread count,
mark-read).

**Proved on LIVE data, rolled back:** flipping Shashwathi's real Cognizant
entry false→true scheduled her into Round 1 and she read "You are shortlisted
for Cognizant" through RLS as herself; recording `selected` on Thanush's real
Accenture application produced "You cleared Round 1 of Accenture", read as
him. Re-saving an already-included entry did nothing — correctly (that is why
the first live attempt looked inert: UAT had already shortlisted him).

💡 **A proof trap worth keeping: UNION ALL branches share one snapshot.** The
first live proof read "0 scheduled" because every check subquery ran in the
SAME statement as the trigger-firing insert. Sequential statements writing to
a temp `proof` table (grant it to `authenticated` first) is the pattern that
works.

### Stage 4 — CSV export · campus CPC full-cycle visibility (`0044`, `0045`)

- **Export shortlist (CSV)** on the shortlisting screen (D4: "csv that excel
  opens"): `serialiseCsv` (domain, RFC 4180, round-trips through `parseCsv`),
  BOM-prefixed at the download, built from **snapshots** (R7), included
  students only, missing resumes named, and **logged to `recruiter_exports`**
  (PRD §13.2) — first writes that table has ever had.
- **`/cpc/drives` — Drive progress** (D10): every drive touching the
  coordinator's students; per student the shortlist standing, each round's
  attendance/result, the offer. Strictly read-only — a test asserts no
  controls exist. `0044` lets campus readers read `drives`.
- 🔴 **`0045` was found by the live proof, not a test:** the campus CPC read
  6 drives, 6 applications and **0 shortlist entries** — `shortlist_staff_only`
  is org-readers-only, so the screen would have said "not shortlisted" about
  everyone. Campus-scoped select-only policy added; **re-proved live: 6.**
  PRD §13.1 is about students, not staff.

### Also in this session

- Mutation checks where tests were written close to code: drive-progress page
  (2 mutations) and view (result-swap, offer-swap) — all caught.
- e2e fake backend now answers `notifications` (the journey's strict
  unhandled-request guard caught the new read — working as designed).
- `docs/domain-model.md` §7 and Q2/Q9 updated for D5/D8; **A38** added
  (waitlisted/on-hold do not notify — one trigger branch if reversed).

⚠️ **Machine note:** another project's vitest was running concurrently and
two of my timed-out runs left zombie WASM-Postgres workers; the suite then
"failed" with 220-second timeouts. `pkill -9 -f vitest`, wait, run once.
Check `ps aux | grep vitest` before believing a slow red suite.

---

## ✅ SHIPPED 2026-08-06 — one email identifies one person (`0040`)

Asked for after P8: *"can you block an email id from being entered twice?
student + student as well as student+staff"*. **This closes P8's root cause**,
not its symptom.

**`pnpm check` exits 0 — 2377 tests across 138 files.** `0040` live, local ==
remote; Cloudflare **`213aa2de-6acf-4589-990b-a60163be05c8`**.

**Two gaps existed, and only one was the obvious one.**

1. **student-vs-student was already `unique` (0003) — but CASE-SENSITIVE.** So
   `Priya@gmail.com` and `priya@gmail.com` were two people to Postgres and one
   person to Google. The roster importer happens to lowercase, which is the
   only reason this never bit.
2. **student-vs-staff was not checked anywhere at all.**

| | |
|---|---|
| Canonical on write | `normalise_email` trims + lowercases on all three tables, so the row read back is the row matched |
| Case-insensitive uniqueness | `one_person_per_email_*` on `students`, `profiles`, `staff_invitations`. The original `unique` columns stay — dropping one to swap in an index is how a window gets left open mid-migration |
| Cross-table | Triggers both ways, against staff **profiles AND unaccepted invitations** — somebody invited but not yet signed in holds their address just as firmly. Raised as `unique_violation` so callers treat it like any other duplicate |
| Layer 0 | `src/domain/email-identity.ts` owns the rule and its wording; the roster preview names the offending **row** rather than failing a file of hundreds with one unattributable error |

🔴 **A staff INVITATION and the PROFILE it becomes are ONE person.** All six
staff in production have both rows — it is the normal state, not a duplicate.
The cross-check therefore compares students against staff and **never staff
against staff**. Getting that wrong would have blocked every staff member from
ever signing in.

Checked against production BEFORE writing it: 0 non-canonical addresses, 0
case-duplicates anywhere, 0 student/staff overlap — so no backfill, and no
existing row these constraints break.

Proved against production afterwards, all rolled back:

| Attempt | Result |
|---|---|
| Same student address twice | refused |
| Same address differing only by case | refused (normalised first, then caught) |
| Student on a **staff** address | refused, naming it |
| Staff invited on a **student** address | refused, naming it |
| Same, with odd casing and whitespace | refused |
| **Invitation → profile still materialises** | ✅ role intact |
| **A genuinely new student still imports** | ✅ stored canonically |

Live JS byte-identical (833 776 bytes, sha256 `ae14f21c…`); 6 new triggers, 3
new indexes, 0 non-canonical rows; counts unchanged (5 students, 6 profiles).

💡 **An existing test failed for the right reason and was NOT just widened.**
`org-hierarchy`'s "stops a student writing themselves a profile" expected an
RLS refusal; 0040 now refuses it one step earlier, on identity. The matcher
was widened **and a second test added** using an address 0040 has no opinion
about — otherwise that file would have quietly stopped proving `profiles` is
protected by RLS at all.

---

## ✅ SHIPPED 2026-08-06 — approving the form confirms its certificates (`0039`)

The client's answer to A37: *"make approving the registration form also
confirm the certificates that came with it, and keep the standing queue for
later uploads."* So it is **both**, and A37 is answered rather than assumed.

**`pnpm check` exits 0 — 2345 tests across 136 files**, plus the Playwright
journey.

| | |
|---|---|
| `0039` | An SRF approval verifies that student's **pending** certificates, stamped with `srf_decided_by`. Modelled on `0031`. Already-rejected ones are left alone — a coordinator refused those, and an approval elsewhere must not reverse it. Already-verified ones are not re-stamped. Nobody else's are touched |
| Later uploads | Still land `pending` → `/cpc/certificates`. That is what makes a certificate earned in the final semester verifiable at all |
| **The screen change that makes it honest** | The verification queue now shows each certificate **beside a signed link to its document**, and the approve button says *"Approving will also verify N certificates"* |

🔴 **Bundling was pushed back on before it was built, and only shipped with
the evidence attached.** The queue did not show certificate documents, so one
click would have certified files the coordinator was never shown — precisely
the hole that made semester verification meaningless before `0023`. `0039` and
the screen change are one commit for that reason. **If you ever move a
verification onto an existing button, move the evidence with it.**

No backfill: production holds zero certificates, and retro-verifying one would
assert a coordinator had checked a document they were never shown.

**LIVE.** `0039` applied (local == remote at `0039`); Cloudflare version
**`e20d2ef3-815d-4569-b404-4149aa85f4bc`**. Proved against production in one
rolled-back transaction, as the real Central CPC:

| Certificate | After approving the form |
|---|---|
| pending | **`verified`**, stamped with the approving coordinator |
| already rejected | **still `rejected`**, reason intact |
| another student's | **untouched**, still `pending` |

Live JS byte-identical to local (832 686 bytes, sha256 `808ddbe2…`);
`Approving will also verify` present in the deployed bundle; 0 rows left
behind.

### ✅ P8 RESOLVED by the client, same day — re-proved live

`sainaveen@faceprep.in` was **removed from staff**, keeping only their student
row. Verified live, not assumed: no profile row at all (not merely
deactivated), **no orphaned invitation**, and `students_who_are_also_staff` is
now **0**. Re-proved end to end on that same account in a rolled-back
transaction — form `srf_approved`, its certificate `verified` and stamped with
the approving coordinator.

💡 **A second guard fired during that proof and was NOT a defect:**
`approved_requires_consent`. Sai Naveen had never actually submitted a form,
so `consent_given_at` was null and approval was refused — correctly. The
artificial setup was mine; a real submission records consent. Worth knowing
before mistaking it for a bug.

⚠️ **Consequence, not a fault: there are now 0 active campus placement
coordinators** and 2 Central CPCs. Nothing is broken — a Central CPC is
org-wide and runs both queues. **The first real campus CPC appointed must be
mapped to a campus and must NOT also be on the student roster**, or P8 returns.

The original report, kept because the trap is general:

### 🔴 A live blocker found while proving it — P8, and NOT caused by this work

**The only campus placement coordinator cannot approve ANY registration
form.** The first approval attempt failed with *"Verified academic data can
only be changed by a placement coordinator"*, raised by
`protect_verified_academics` (**0009**, so this has been true since long
before today).

`sainaveen@faceprep.in` is **both a staff profile and a student row** on one
Google account. That guard identifies students *positively* by
`auth_user_id` — deliberately, so it fails closed — and therefore sees the
coordinator as a student and refuses the `srf_status` write. The Central CPC
is unaffected, which is why nobody has hit it yet.

The fix is a **data** decision, not a code one, and is in
`docs/PENDING-USER-ACTION.md` as **P8**. Relaxing the guard for anyone holding
a staff profile was deliberately NOT done: it would also let that same person
edit their own verified marks.

---

## ✅ SHIPPED 2026-08-06 — certificates are verified, like a CGPA

Asked for: "skill certifications uploaded by students will also need
verification of campus placement coordinator similar to CGPA approval. This is
applicable for first upload as well as subsequent additions."

**`pnpm check` exits 0 — 2331 tests across 135 files**, plus the Playwright
journey.

**LIVE.** Migration `0038` applied to Mumbai (local == remote at `0038`);
Cloudflare version **`a63ceefb-2f7d-41dd-8e89-3aacd3ff0bcf`**.

Verified against LIVE rows and the LIVE bundle:

| Check | Result |
|---|---|
| Certificates in production before the change | **0** — the `pending` backfill touched nothing |
| New columns · both constraints · UPDATE policy · UPDATE grant · audit trigger | 4 · 2 · 1 · 1 · 1 |
| Student delete rule, read back from `pg_policy` | `student_id = current_student_id() AND status <> 'verified'` |
| **The campus CPC verifies**, as the real live coordinator through RLS | `verified`, `verified_by` = that CPC |
| **The student cannot verify** their own | stayed `pending` |
| **The student cannot delete a verified one** | row survives, still `verified` |
| The decision is audited | 1 audit entry |
| Rows left by those proofs | **0** — all rolled back |
| Live JS byte-identical to local `dist/` | 831 203 bytes, sha256 `cf9bb1ab…` |
| `Certificate verification` · `Open certificate` · `Awaiting verification` · `No document uploaded` | all present |
| `/cpc/certificates` | 200 |

⚠️ **The staff roles were reshuffled mid-session, and it invalidated an
actor mid-proof.** `ashokkumar091293@gmail.com` was Central CPC when the skill
repository shipped an hour earlier and is **`delivery_head`** now; the first
verify-as-coordinator attempt therefore did nothing, and looked exactly like a
broken policy. It was not — `is_operator()` was correctly false for a Delivery
Head. **Re-read `profiles` immediately before using somebody as a test actor.**
Current holders: **`radhika@faceprep.in`** Central CPC, **`sainaveen@faceprep.in`**
campus CPC (the FIRST real one — §1 item 3's "no CPC exists" is now stale),
both re-proved above and the skill repository re-proved as radhika.

⚠️ **`sainaveen@faceprep.in` is BOTH a staff profile and a student row**, on
the same auth user. `current_app_role()` and `current_student_id()` therefore
both resolve for them, which no policy was designed for. Test data today; it
would let one person verify their own certificate. Worth a decision.

0034 stored a name and a document and stopped there. **Nothing recorded
whether anybody had ever opened the file**, and there was no screen on which
to do it — so a recruiter reading a profile could not tell a checked
certificate from a claim typed a minute earlier.

| Layer | What |
|---|---|
| 0 | `decideCertificate` (pending → verified \| rejected, rejection needs a reason), `canRemoveCertificate` (Q4: a verified one is no longer the student's), `certificateStanding` (what the student is told). `VERIFICATION_STATUSES` is now a real domain enum, registered in the drift guard |
| 1 | **`/cpc/certificates`** — campus CPC *and* Central CPC. Certificate name beside a signed link to the document, verify or reject with a reason. "No document uploaded" rather than a dead link |
| 1 | The student sees the outcome in **both** places their certificates appear: `/student/profile` and the read-only SRF record. A rejection shows its reason; a verified one offers no Remove |
| 2 | `0038` — `status`/`verified_by`/`verified_at`/`rejection_reason`, `certificate_verified_has_verifier`, `certificate_rejected_has_reason`, an UPDATE policy for campus staff (0034 had none, **and no update grant**), the student's delete narrowed to non-verified, and the audit trigger 0034 never had |

🔴 **The dangerous half was `submit_srf`, and it is the exact bug that made
the SRF unsubmittable for every student before 0027.** 0035 replaced the
certificate list wholesale: delete all, insert the payload. Once a certificate
can be verified, the delete is filtered by RLS to *nothing* for that row —
RLS is a filter, not an error — and the insert then re-declares it and hits
`one_certificate_per_name`, raising 23505 and failing the **whole**
submission. 0038 deletes only what is undecided and inserts only what is not
already on file, compared exactly the way the unique index compares it. Three
regression tests cover it, including re-declaring under different spacing.

This deliberately differs from the semester lines, where the collision IS the
answer: a semester is only verified at approval, after which the form is
read-only, so a verified line and a re-submission cannot co-occur. A
certificate is verified on its own schedule, so they co-occur constantly.

📌 **A37** records the interpretation: "similar to CGPA approval" is read as
the same *standing*, not the same *moment* — see `docs/ASSUMPTIONS.md`.

---

## ✅ SHIPPED 2026-08-06 — the Central Student Skill Repository (PRD §5)

Asked for: skillsets per student (Aptitude, Communication skills,
Fundamentals of Programming, Data Structures and Algorithms, GitHub strength,
Programming skills, AI skills, AI-assisted Full Stack Development — "more can
be added"), maintained by the Central CPC, with bulk add and edit, to be
mapped to job roles for shortlisting later. **This partially answers P3** —
the open question R11's ranking was waiting on.

**`pnpm check` exits 0 — 2269 tests across 132 files.**

**LIVE.** Migration `0037` applied to Mumbai (`supabase migration list
--linked` shows local == remote at `0037`); Cloudflare version
**`32348e97-401f-4a93-9aa3-9ac9b5b10688`**, <https://fpc-pms.faceprep.workers.dev>.

🔴 **The irreversible half was checked BEFORE the push, not after.** 0037
**drops** 0003's `skill_scores` placeholder. Live count before pushing:
**0 rows** — so the drop destroyed nothing. Had it been non-zero the migration
would have needed a migrate-then-drop instead. Check the row count before
any future `drop table`; the schema cannot tell you what is in it.

Verified against LIVE rows and the LIVE bundle immediately after the push:

| Check | Result |
|---|---|
| `supabase migration list --linked` | local == remote at **`0037`** |
| `skill_areas` seeded | **8**, exactly the areas asked for |
| `skill_scores` (0003 placeholder) still present | **0** — dropped |
| Policies on `student_skill_scores` / `skill_areas` | 4 and 4; RLS enabled **and forced** |
| `audit_skill_scores` trigger | present |
| **A36, as a REAL student** — score seeded in-transaction, then read as its own student | **0 rows visible** |
| **Central CPC writes**, as the real live Central CPC through RLS | inserted and read back `GitHub strength 82.50` |
| Rows left in production by those two proofs | **0** — both ran in a transaction and rolled back |
| FKs `student_skill_scores`→`skill_areas` / →`students` | **1 and 1** — embeds unambiguous, no PGRST201 |
| Live JS byte-identical to local `dist/` | 824 988 bytes, sha256 `1575165e…` |
| `Skill repository` · `Add skill area` · `skill-scores-template.csv` in the live bundle | all present |
| `from("skill_scores")` anywhere in the live bundle | **0** — shortlisting reads the real repository |
| `/central/skills` through the SPA fallback | 200 |

⚠️ **Pre-existing finding, NOT introduced here, needs a decision.**
`authenticated` holds `TRUNCATE, REFERENCES, TRIGGER` on the new tables — and
on `students`, `offers` and every other table, because a Supabase project
ships `grant all` on the public schema. **TRUNCATE is not subject to RLS**, so
in principle any signed-in user could truncate a table. The explicit `grant
select, insert, update, delete` in our migrations is a no-op on top of it.
This is the same grant drift §1 already warns about (it is why a local schema
test could not reproduce a live failure). Fixing it is one project-wide
`revoke`, deliberately not done at ship time.

| Layer | What |
|---|---|
| 0 | `src/domain/skills.ts` (100%): the eight seed areas; `validateSkillAreaName` (case/space-insensitive uniqueness); `parseSkillScore` (0–100, ≤2 decimals — A35); `parseSkillSheet` — the CSV bulk template (`roll_number` + one column per area), row-level rejections, blank cell = SKIPPED never zero (which is what makes it the bulk EDIT), unknown column = fatal so a misspelt column cannot silently discard an assessment |
| 1 | `/central/skills` (Central CPC nav: "Skill repository"): add areas, inline per-student edit, bulk apply-to-selected, CSV import with per-row errors + template download prefilled with roll numbers. Clearing a score DELETES it — unmeasured must not read as zero |
| 1 | `skills-view.ts` — upsert on `(student_id, skill_area_id)`, every row names `recorded_by`; select registered in `query-contract.test.ts` |
| 2 | `0037`: `skill_areas` (seeded, unique on the normalised name — mirrors `skillAreaKey`), `student_skill_scores` (one per student×area, `score_within_scale` 0–100, audit-triggered). RLS: staff read (campus-scoped via `my_student_ids()` for campus roles), writes `is_operator()` only, **students read nothing (A36)** |
| R11 | `shortlist-view` now reads the REAL repository (`student_skill_scores` + area names) — the invented `skill_scores` table (A12) is **dropped by 0037**, so skills recorded on this screen flow straight into `rankApplicants`'s mandatory-skill match |

Still assumptions, cheap to reverse (see `docs/ASSUMPTIONS.md`): **A35** the
0–100 scale · **A36** students cannot see their scores · A12's ranking
weights. The job-role mapping itself is already live: a drive's
`mandatory_skills` are matched against these scores by name in R11.

---

## ✅ SHIPPED 2026-08-06 — UAT round 2 (F18–F21)

Four items, from three screenshots and one sentence. Extracted into
`docs/UAT-2026-08-06-feedback.md` under "Round 2". **`pnpm check` exits 0.**

**Cloudflare version `df9a53a8-bbc8-4542-83f6-e555c2e80658`**,
<https://fpc-pms.faceprep.workers.dev>. **No migration** — every column and
table already existed (`other_profiles` 0025, `student_certificates` and
`document_kind 'certificate'` 0034), and `supabase migration list --linked`
still shows local == remote at `0036`. A front-end release, nothing else.

Verified against the LIVE bundle immediately after the push, not assumed:

| Check | Result |
|---|---|
| Live `index.html` names the asset the local `dist/` built | `index-BdgZlbE4.js` |
| Live JS is byte-identical to the local build | 811 138 bytes, sha256 `03e4a5bb…` |
| `One interview process, however many designations — one PIF.` | present, real em dash |
| The literal `\u2014`, anywhere in the bundle | **0** |
| `My skills, certificates and links` · `Add certificate` · `No certificates uploaded` · `Remove semester` | all present |
| The retired `My skills and links` title | gone |
| `/student/profile`, `/srf`, `/ae/pif` through the SPA fallback | 200 |

| # | What changed |
|---|---|
| F18 | **Several semesters at once**, capped at 10 UG / 4 PG as a TOTAL. `addableSemesters` (domain) counts what is already on the record against the cap; each row is a `<fieldset>` with its own marksheet, so two scans cannot be swapped |
| F19 | `/student/profile` **looks like the registration form**: three numbered sections built from `FormSection`, which was lifted out of `srf-page.tsx` into `@components/form` rather than copied |
| F20 | **Certificates on that page** — what is on file, a signed link to each document, add one, remove one. F9's "once" is `canUploadCertificate` on screen and `one_certificate_per_name` (0034) underneath |
| F21 | Two JSX text nodes printed `\u2014` verbatim. `src/copy.test.ts` fails on any of them |

### Three things fell out of it that were nobody's report

1. **`students.certifications` was still being written.** `submit_srf` stopped
   writing it in 0035 because free text can be neither verified nor
   de-duplicated (F9/F17) — but `/student/profile` kept a box called
   "Certifications" wired straight to the column. A student typing into it was
   writing to a field nothing reads. That box is gone, and the read-only SRF
   record now lists the certificate ROWS instead of the dead column.
2. **`other_profiles` was write-only.** The SRF has collected Kaggle,
   Codeforces and portfolio links since 0025, and no screen anywhere read them
   back. A student who added three could see none of them and edit none of
   them. They are on the profile page now, with the domain's both-halves rule.
3. **A second `\u2014`**, in the SRF's "no programmes mapped to your college"
   warning — the one message a blocked student is guaranteed to read.

### What the tests are worth

- F18 and F19/F20 were driven red-first: 8 failing component tests for the
  multi-semester panel, 13 for the profile page, then the code.
- `profile-repository.test.ts` was written **after** the repository, so every
  test in it was **mutation-checked** — 11 deliberate breakages (wrong document
  kind, untrimmed name, upload outside the student's folder, unscoped delete,
  unsigned URL, swallowed upload failure, dropped `Array.isArray` guard,
  un-normalised links, `orNull` returning the raw string...), every one caught.

---

## ✅ SHIPPED 2026-08-06 — the whole UAT round is live

**Migrations `0032`–`0036` are applied to Mumbai.** `supabase migration list`
shows local and remote level at `0036`.

**Cloudflare version `219d3bd8-48b0-4e96-acac-4ed8467c2aca`**,
`https://fpc-pms.faceprep.workers.dev`. The live `index.html` references the
same asset hashes as the local `dist/`, and the deployed bundle contains F14's
confirmation copy — checked, not assumed.

Verified against LIVE rows immediately after the push:

| Check | Result |
|---|---|
| `campus_programmes` backfilled | **2** |
| Students on the roster | 5 |
| **Students left with no programme mapped** | **0** |
| `submit_srf` arity | 4 |
| `opt_out_requests.decision_reason` | present |
| `student_certificates` | present |
| `student_documents.drive_id` | present |
| `drives.round_count` | present |

New routes all resolve through the SPA fallback: `/student/opt-out`,
`/student/off-campus`, `/cpc/opt-outs`, `/cpc/off-campus`, `/my-drives`.

🔴 **The backfill was the whole risk, and it was caught while preparing the
push, not by a failing test.** `campus_programmes` starts empty and the
registration form now offers only what it contains — so 0036 without a
backfill would have blocked every student on the roster from selecting a degree
the moment it landed. The "0 students left with no programme mapped" row above
is the proof it did not.

---

## 🔴 THE WORK — UAT "Copy of Testing", 2026-08-06

Seventeen items, extracted verbatim into **`docs/UAT-2026-08-06-feedback.md`**
(F1–F17). **All seventeen are shipped in code**; two carry a manual follow-up,
recorded in `docs/PENDING-USER-ACTION.md`.

Six migrations: `0032`–`0036` plus the `submit_srf` replacement.

| # | What changed |
|---|---|
| F1 | A participation request may be **declined with a reason**, and the reason is required — `0032` enforces it, so no screen can forget. It is the only thing the student is told. |
| F2 | Opt-out and off-campus offers were one nav entry, one page and one queue. Now separate heads for the student and both coordinators. |
| F3 | Every request the student raised stays on their screen with its outcome. It used to vanish the moment a coordinator touched it. |
| F4 | Campus dropdown on the dashboard, all campuses by default. Filters the cohort **once**, feeding both the overview and the placement figures. |
| F5 | "Registration funnel" → **"Students overview"**, four stages. The fifth moved into a **drive-progress box** with drive/college filters. |
| F6 | A programme is college + degree + branch + year (`0036`). `/admin/programmes` is gone; the student gets one dropdown. |
| F7 | One interview process covering several designations is ONE PIF. |
| F8 | **Activate** beside Deactivate on the staff page. |
| F9 · F17 | A certificate is a **name and a document**, uploaded once (`0034`, `0035`). |
| F10 | Re-verified: `student-sees-drives.test.ts` proves it against real RLS. |
| F11 | The AE states the number of rounds; the publish screen fetches it. |
| F12 | The CGPA cutoff may be stated as a **percentage**. |
| F13 | A **"+"** for the semester that finished after registration. Lands `pending`. |
| F14 | **View more**, an **apply confirmation**, and a **drive-specific resume** (`0033`). |
| F15 | The AE's drive module is the Central CPC's too, with shortlisting access. |
| F16 | The shortlist screen now changes after saving. |

### 🔴 Two live defects found on the way, both now fixed with regression tests

Neither was reported, and neither would have been found by looking.

**1. Every PIF submission was validated as a DRAFT.** `onClick={run("submit")}`
CALLS `run` during render, and `run` set `intent.current` as a side effect —
so whichever button rendered last won, and that was "Save draft". An AE could
hand the Delivery Head a PIF with no role, no CTC, no eligibility and no
passing years. **The only symptom was an approval queue full of empty forms**,
which is exactly why nobody filed it as a bug.

**2. A blank optional number was submitted as a real zero.** Found the instant
(1) stopped hiding it: a COMPLETE PIF then failed on "Maximum CTC cannot be
below the minimum". RHF hands `setValueAs` the DEFAULT value — `null` — for a
field nobody typed in, and `Number(null)` is `0`. So every blank optional
number arrived as zero: a maximum CTC of 0, and **a CGPA cutoff of 0 recorded
as a cutoff rather than as "none set"**.

### ⚠️ Still to do by hand

- **F9's second half** — deleting the previously uploaded test certificates is
  a production data operation, and nothing in the schema distinguishes a test
  certificate from a real one. The inspection query is in
  `docs/PENDING-USER-ACTION.md`. A certificate lives in **two** places now, so
  both the row and the storage object have to go.
- **`students.certifications`** is superseded and no longer written. It is
  deliberately NOT dropped: dropping a column holding real data is a separate,
  irreversible decision.
- ⚠️ **The same marksheet has two different upload rules.** A semester
  marksheet added through F13's "+" accepts `application/pdf,image/*`
  (`add-semester.tsx`); the SAME marksheet on the SRF itself accepts PDF only
  (`UPLOAD_ACCEPT`, `form.tsx`). So a student can photograph semester 5 and
  could not have photographed semesters 1–4. Introduced by F13 and shipped.
  See §1 item 2 — it is the same open question, now with a live inconsistency
  sitting on top of it.

### 📌 Assumptions added

- **A34** — the plausible range for a year of passing (2015–2100), in
  `src/domain/programmes.ts` and `0036`, mirrored so they cannot drift.

⚠️ **The header of this file has now been wrong three times, the same way.**
It cited `a4f1c9e`, `d0c1e2f` and `3e037c3`; the first two never existed and
`3e037c3` was **orphaned by a `git commit --amend`** made after the hash was
written into the doc. Verify with `git merge-base --is-ancestor <hash> HEAD`,
not with `git cat-file` — an amended-away commit is still a valid object and
will happily answer "commit". **Write the hash last, after the commit exists,
and never amend afterwards.**

📌 **THE WHOLE CHAIN IS PROVEN IN PRODUCTION** (verified 2026-08-05 10:05 UTC,
against live rows, not MSW): publish → visible to the targeted students →
**apply** → profile snapshot taken. **Five real applications** exist across
three students and both drives, every one carrying a `profile_snapshot`. That
is the first time anything past "approved" has run on real data.

---

## 🔴 SHIPPED 2026-08-05 — students could never see ANY drive

Reported: "even after drives are published by Central PC, they are not shown to
eligible students" — TCS and Cognizant, for all three approved students.

They were eligible on every count: both drives `live`, inside their window,
targeted at exactly their campus, degree and branch, cutoffs cleared. **They
could not see the row.** `0008` gave `drives` five policies and not one admits
a student — the comment says why:

```sql
-- Students never read the drives table directly; they read a filtered view.
create policy drives_staff_read on drives for select using (is_org_reader());
```

**The filtered view was never built.** The screen queries `drives` directly,
RLS filtered it to nothing, and the page rendered a healthy-looking "no drives
open to you right now". **Every student has seen that since the day it
shipped.** MSW has no row-level security, so the component tests passed against
data the real database would never return.

`0030` adds `drives_student_read`: published statuses, targeted at their campus
or targeted at nobody. Deliberately coarser than R5/R6, which stay in
`src/domain/visibility.ts` and decide who may APPLY, with reasons.

⚠️ **It also closed a hole.** `drive_target_campuses`,
`drive_eligible_degrees`, `drive_eligible_branches` and `drive_rounds` had RLS
**switched off entirely** while `0008` grants insert/update on every table to
`authenticated`. Any signed-in student could add their own branch to a drive
they were not eligible for. Now readable by all (a student is entitled to know
why they do not qualify), writable only by the drive's owners.

💡 **The write policies are three commands, not one `for all`.** A `for all`
policy also covers SELECT; these conditions read `drives`, whose student policy
reads these tables back, and Postgres refuses the whole query with **"infinite
recursion detected in policy"**. Keeping the read path free of any reference to
`drives` is what breaks the cycle.

---

## 🔴 SHIPPED 2026-08-05 — approval did not verify the semesters

Found while fixing the above. Every approved student carried
`student_semesters.status = 'pending'`: `decide()` updates the students row and
nothing else.

`academicStandingFrom` counts only VERIFIED semesters (§7.2). With none
verified it returns null, the drives view falls back to
`students.overall_cgpa` — which the SRF deliberately never writes, because an
overall CGPA is not the student's to declare — so **every approved student was
being judged at a CGPA of zero.**

Nothing was broken yet: neither live drive sets a CGPA cutoff. **The next drive
that sets one would have silently excluded the entire cohort, and it would have
looked identical to the bug above.**

`0031` makes approval do what it claims: the queue puts each declared figure
beside its marksheet and asks the coordinator to compare them, so pressing
approve records `verified` on those rows. Backfilled for the three already
approved, scoped to forms that are approved AND name a decider.

---

## ✅ END-TO-END, PROVEN AGAINST LIVE DATA 2026-08-05

The full chain finally ran in production, on real students, without help:
re-submit → queue → verify → approved. Three students (`Test`,
`Thanush Krishna`, `Shashwathi Test`) are `srf_approved`, decided by the
Central CPC at 09:33 UTC.

**Shashwathi's stale-evidence problem resolved itself the right way.** Her
semester lines had pointed at her first attempt's files (two copies of a
generic `images (1).pdf`); after the re-submission fix shipped she re-submitted
and the atomic RPC replaced them with the correctly named marksheets. No
manual data repair was done, and none was needed — which is why it was left to
her rather than edited on her behalf.

---

## 🔴 SHIPPED 2026-08-05 — two screens were 400ing in production

Reported: "campus placement coordinator in the verification queue sidebar is
just getting an error msg that could not load verification queue."

**`PGRST201` — ambiguous embed.** Neither select had changed. The SCHEMA moved
underneath them: `0023` added `students.ug_marksheet_id` and `0024` added
`students.diploma_marksheet_id`, both referencing `student_documents`. Three
keys now join those two tables, which is two more than PostgREST will resolve,
so it refused the query outright. **The student drives list was broken exactly
the same way and nobody had reported it.**

Both now name the key: `student_documents!student_documents_student_id_fkey`.

⚠️ **The lesson generalises: a migration can break a query it never mentions.**
`query-contract.test.ts` checked that every column in a select exists — which
both selects passed. A select can name every column correctly and still fail
outright on the embed. It now also resolves each embed against `pg_constraint`
and fails when more than one key joins the tables without the select naming
one. **The verification queue's select was not registered there at all**, which
is the only reason that file stayed green while the queue 400'd for everyone.
**If you add a hand-written select, register it.**

---

## Campus mapping — a coordinator is ONE campus (2026-08-05)

The only CPC in production was mapped to **no campus**. `my_student_ids()`
derives their entire authority from that mapping, so they saw nobody, and the
screen said nothing. It could not be fixed from the app either — campuses were
chosen only at INVITE time, so the mapping was write-once at account creation.

- `campusScopeFor` / `validateCampusSelection` own the rule: **coordinator =
  exactly one campus**; campus managers and KAMs keep the list.
- `setCampuses` re-maps existing staff, applied against the profile once they
  have signed in and staged against the invited email until then — both halves
  are now READ back too, so an invited coordinator no longer looks unmapped.
- The staff row and the shell both say **"No campus mapped"** outright.
- `0029` enforces it in the database. Moving a coordinator works; adding a
  second campus does not.
- `AuthState.campuses` is **required**, not optional — making it so surfaced
  eleven call sites at compile time.

📝 Roles were reshuffled by the Admin mid-session: there is currently **no
`campus_placement_coordinator` at all**. "Ashok" is now Central CPC, which is
org-wide and needs no campus — which is why verification worked without one.
**The first real CPC created must be mapped to a campus, and the UI now says so
if they are not.**

---

## The registration form has three lives (2026-08-05)

It used to be editable at every status. Not cosmetic: §7.2 judges eligibility
on VERIFIED data, so a student editing an approved record silently invalidates
every shortlist it has already been measured for.

`srfAccess` (domain) decides: not sent → **edit** · submitted → **view**
("Awaiting verification", no submit, no draft, no link) · sent back → **edit**
with the coordinator's reason at the top · approved → **view** ("Verified")
plus a link to what is still theirs.

`/student/profile` is that link's destination, bounded by R10: skills,
interests, projects, certifications, achievements, four profile links. **No
marks, no arrears, no semester lines** — a test asserts their absence by label.

📌 **THE FIRST REAL SUBMISSION LANDED IN PRODUCTION.** See §1b. The evidence
chain that every session since 2026-08-04 has been asking someone to prove is
now proven against live data, not against MSW.

---

## 🔴 SHIPPED 2026-08-05 — the SRF could only ever be submitted ONCE

UAT: "Shashwathi Test is not able to submit the student registration form."
**Not user error.** Three defects, all live, all now fixed and deployed
(version `0a06b41c-0c78-4141-9292-b28aa446cc55`, migrations `0027`+`0028`,
local == remote).

**1. Re-submission was impossible (the blocker).** Submitting replaces the
semester lines wholesale — delete, then insert. `0008` granted students
`select, insert` on `student_semesters` and **no delete**, so the delete
matched nothing; RLS is a filter, not a guard, so it raised no error and
PostgREST answered `204`. The insert then hit the unique key. Live edge logs:
**eight `POST /rest/v1/student_semesters`, eight `409`s**, eight identical
"Could not submit your form. Please try again." The FIRST submit always
worked and every later one was unreachable.
→ `0027` adds `semesters_delete_self`, scoped to the student's own **pending**
rows, and grants the delete. Note `0008` grants `delete` on **nothing**, so
`semesters_write_staff` (`for all`) had been quietly unusable for deletes on
any database built from these migrations — production only worked because a
Supabase project ships with `grant all`. **That drift is why local schema
tests could not reproduce a live failure.** Check grants when they diverge.

**2. Submission was not atomic.** Four round trips = four transactions, so a
failure at the third committed the first two. The live database held a student
row saying `srf_submitted` while the student was correctly being told it had
failed.
→ `0028` adds `submit_srf(p_student, p_semesters, p_documents)` — one
statement, one transaction. **`security invoker`**, verified on the remote
(`prosecdef = false`): RLS, `protect_verified_academics` and every marksheet
trigger still judge the caller. The payload names no student; identity comes
from `current_student_id()`. Document rows are written inside the transaction,
so a failed submit no longer orphans them; storage uploads still happen first
and on purpose (an object with no row is invisible, a row with no object asks
a coordinator to verify against a document that is not there).

**3. Runaway auto-save.** `saveDraft` is a **default parameter** of `SrfPage`,
so it was a new function identity every render, and it sat in the auto-save
effect's dependency array: save → `setState` → re-render → new identity →
save again, once a second, for as long as the tab was open. One student wrote
**1,816 audit rows in 35 minutes**. Auditing is append-only, so every one is
permanent. Now held by ref. The existing page tests could never catch it —
they all inject `saveDraft` as a stable `vi.fn()`, the one case where the
identity does not change. `src/features/srf/srf-autosave.test.tsx` drives the
real default path.

⚠️ **Outstanding, needs a decision — Shashwathi's record
(`1cf17525-59b5-42f3-9f41-f671d017f7e5`) is in the queue but its evidence is
wrong.** Its semester lines still point at her FIRST attempt's files (two
copies of a generic `images (1).pdf`); the correctly-named marksheets she
uploaded at 07:57 are among **34 orphaned document rows**. A coordinator
verifying her now would check marks against the wrong scans. **Nothing was
edited** — repointing a student's academic evidence on their behalf is exactly
what `protect_verified_academics` exists to prevent. The clean repair is for
her to re-submit, which now works and is atomic. **Tell the CPC not to verify
her until she has.**

💡 **How this was diagnosed, because it generalises:** the Supabase Management
API (`POST /v1/projects/{ref}/database/query`, token in the macOS keychain
under `Supabase CLI`) and the log endpoint
(`analytics/endpoints/logs.all`, with `iso_timestamp_start`/`_end` — the
default window is short). `edge_logs` filtered to `status_code >= 400` named
the failure in one query after the code review had not. Reach for the logs
before the source.

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
1. ~~Verify that submission as the campus CPC~~ **DONE 2026-08-05 09:33 UTC.**
   All three students are `srf_approved`, and since `0031` their semesters are
   `verified` with the decider named — so R5 now reads a real verified CGPA
   rather than the A28 fallback. They have since **applied**: five
   applications, both drives, snapshots taken.
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
pnpm test:run        # expect 1695 passing across 114 files
pnpm test:e2e        # expect 1 journey passing
pnpm dev             # localhost:5173
```

💡 **Verifying production is cheap and has caught four bugs the tests could
not.** The Supabase Management API takes SQL directly — token in the macOS
keychain under `Supabase CLI`:

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/poscikalmgfpvbjfytgw/database/query" \
  -H "Authorization: Bearer $(security find-generic-password -s 'Supabase CLI' -w)" \
  -H "Content-Type: application/json" --data "$(jq -Rn --arg q "$(cat)" '{query:$q}')"
```

To see what a **student** sees — which is how the invisible-drives bug was
found — wrap the query so RLS actually applies:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<auth_user_id>', true);
select ...;      -- now filtered exactly as it is for that person
rollback;
```

`analytics/endpoints/logs.all` takes `iso_timestamp_start`/`_end` (the default
window is short). `edge_logs` filtered to `status_code >= 400` named the
PGRST201 outage in one query after a code review had missed it.

Ship with `pnpm db:push` (migrations) then `pnpm deploy` (Cloudflare). Both were
run this session and both succeeded; **neither is automatic** — committing does
not deploy. `pnpm supabase migration list --linked` is how you check.

Git is **local only**, no remote. 106 commits, working tree clean.
