# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
Last updated at commit `344d424`. **1318 tests passing across 97 files**, plus
**1 Playwright journey** (verified by running them, not remembered).
**`pnpm check` exits 0** — lint, typecheck and every coverage gate.

**Live and shipped 2026-08-05:** <https://fpc-pms.faceprep.workers.dev>
(version `fda30ffd-604a-4981-b1d1-b8d1fbf62a70`) · database on Supabase
ap-south-1 · migrations `0001`–`0019`, **local == remote** (`supabase migration
list --linked`).

Verified after shipping, not assumed:
- `is_campus_reader()` on the remote includes `key_account_manager`;
  `is_org_reader()` includes `enterprise_relations`
- all nine new/replaced policies exist; the old `semesters_rw_staff` is gone
- the deployed bundle contains the new screens and **none** of the mock's
  strings — no "Welcome back", no "Freshworks", no "Download offer letter"
- live row counts unchanged (3 students, 1 drive, 5 profiles): `0018`/`0019`
  touch policies only, never data

---

## 0. The standing rule (from CLAUDE.md — non-negotiable)

**TDD is mandatory.** Red → green → refactor. No production code before a
failing test. Never edit a test to fit broken code. Never `.skip` to go green.

Make reasonable assumptions and keep moving; mark them
`⚠️ ASSUMPTION — UNCONFIRMED` at the call site and list them in
`docs/ASSUMPTIONS.md`.

---

## 1. 🔴 The immediate next step

Everything built in this session is **shipped**. In order:

1. **Nobody has exercised the two new screens against live data.** There are
   0 applications and 0 semesters in Mumbai, so the student dashboard shows its
   empty states and the portfolio shows one TCS drive with no applicants. Get
   one student through SRF → CPC verification → apply, and the whole chain is
   proved against real data for the first time.
2. **No KAM or ER profile exists yet**, so `0018` is correct-but-unexercised in
   production. The first KAM invitation is the real test: assign campuses on
   the Staff screen and confirm they see those students and no others.
3. **Per-semester marksheet uploads** tied to `student_semesters.marksheet_id`.
   The uploads exist; nothing attaches them to the semester row they evidence.
4. **Playwright journeys for the other roles.** The student journey is the only
   one, and it is the only thing that proves the wiring.
5. **Result corrections** (A15) and the notifications UI (blocked on P1).

---

## 1a. What was built on 2026-08-05

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
- **A missing asset path returns `index.html` with HTTP 200.** Verifying a
  deploy with `curl .../assets/<wrong-name>.js | grep -c` therefore reports 0
  for everything and looks like a broken deploy. Read the asset name out of the
  live `index.html` each time, and check the size or hash.
- **`git checkout <file>` will eat uncommitted work** — the warning below is
  there because it happened again on 2026-08-05, to `dashboard-view.ts`, during
  a mutation check. Back the file up *before* mutating, restore from the
  backup, and never let `git checkout` near it.
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

## 5. Live database state (last checked 2026-08-04 — NOT re-checked this session)

```
students 3 · drives 1 · staff 5 · student_semesters 0 · applications 0
```

- All 3 students are `BCA / AI and DS / 2027`, **none `srf_approved`** — so the
  publish screen correctly shows **0 of 3** eligible, all excluded as *"SRF not
  yet verified"*. That is not a bug.
- The one drive is **TCS, `approved`**, with **no application window and no
  rounds** — it cannot go live until someone sets them on `/central/publish`.
- `thanush@faceprep.in` has an `auth.users` row but **no invitation and no
  profile** — a ghost from a removal. Re-invite them from the Staff page and
  `0016` will materialise the profile immediately.
- Nobody has a verified semester, so eligibility is running on the **A28
  fallback**. Getting one student through SRF → CPC verification would prove
  the chain against real data for the first time.

---

## 6. Not built yet

**Screens missing, rules and repositories present:**
- ~~Student dashboard on real data~~ **built 2026-08-05**
- ~~Delivery Head / AE dashboards~~ **built 2026-08-05**
- Per-semester **marksheet** uploads tied to their semester row (the uploads
  exist but are not attached to `student_semesters.marksheet_id`)
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
pnpm test:run        # expect 1093 passing across 85 files
pnpm test:e2e        # expect 1 journey passing
pnpm dev             # localhost:5173
```

Ship with `pnpm db:push` (migrations) then `pnpm deploy` (Cloudflare). Both were
run this session and both succeeded; **neither is automatic** — committing does
not deploy. `pnpm supabase migration list --linked` is how you check.

Git is **local only**, no remote. 67 commits, working tree clean.
