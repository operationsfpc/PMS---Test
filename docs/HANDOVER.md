# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
Last updated at commit `f12bb6d`. **949 tests passing across 77 files**, plus
**1 Playwright journey** (verified by running them, not remembered).

**Live:** <https://fpc-pms.faceprep.workers.dev> (version `42d938fe`) · database on
Supabase ap-south-1 · migrations `0001`–`0017`, local == remote.

---

## 0. The standing rule (from CLAUDE.md — non-negotiable)

**TDD is mandatory.** Red → green → refactor. No production code before a
failing test. Never edit a test to fit broken code. Never `.skip` to go green.

Make reasonable assumptions and keep moving; mark them
`⚠️ ASSUMPTION — UNCONFIRMED` at the call site and list them in
`docs/ASSUMPTIONS.md`.

---

## 1. 🔴 The immediate next step

**Two dashboards were asked for and are NOT built. Do these next.**

### (a) The student dashboard — `/student` is still a mock

`src/features/student/student-dashboard.tsx` is hardcoded JSX: *"Welcome back,
Priya"*, a fabricated Freshworks offer, a fake "Download offer letter" button.
It is **the student's landing route** (`landingRouteForRole("student")`), so it
is the first thing every student sees, and it is live in production.

Build it the way every other real screen is built: a `StudentDashboardView`
interface, a `createSupabaseStudentDashboardView`, a route wrapper. It should
show the student's **own** SRF status, their semester record, drives they have
applied to, their rounds and their offers.

The SRF half of this is already done — `SrfRoute` prefills identity from the
roster (`srf-profile.ts`). Follow that shape.

### (b) Delivery Head and Account Executive dashboards

Requested 2026-08-04: *"they should be able to see all drives they have
raised/approved, applicants to the drive, the progress of the drives"*.

Neither role has a dashboard. Both currently get the **Drive cockpit**
(`/central/drives`), which shows drives + rounds + application counts, but not
"raised by me" / "approved by me", and no applicant list.

`/dashboard` already exists and is REAL (`dashboard-view.ts`) — placement
statistics, campus-scopable. It serves CEO, ER Head, Campus Manager, KAM, ER.
Consider extending it rather than building a sixth variant; `DashboardRoute`
already labels it per role.

### ⚠️ Before building (a) or (b), fix this — it is a live defect

`is_campus_staff()` in `0008_rls.sql` is **`campus_placement_coordinator` and
`campus_manager` only**. `is_org_reader()` is **admin, central CPC, delivery
head, ceo, er_head**.

So **`key_account_manager` and `enterprise_relations` match NEITHER**. They can
read **zero students**. Both already have a nav link to `/dashboard`, which will
render all zeros for them and look broken.

This is **latent, not yet visible**: no KAM or ER profile exists on the live
project today (checked). It bites the moment one is invited.

Worse, `requiresCampusAssignment()` in `src/domain/staff.ts` **does** include
`key_account_manager` — so a KAM is given campus assignments that no policy ever
consults. Decide whether KAM is campus-scoped (likely, then add it to
`is_campus_staff()`) or org-wide, and write the RLS test first.

`DashboardRoute` passes **no** `campusIds` and relies entirely on RLS for
scoping. That is the right design, but it means the RLS above is the ONLY thing
preventing a Campus Manager from seeing another campus's students. Untested RLS
is a data breach (CLAUDE.md).

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

## 5. Live database state (checked this session)

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
- Student dashboard on real data (§1a)
- Delivery Head / AE dashboards (§1b)
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
| **new** | Is **KAM campus-scoped or org-wide?** Blocks §1's RLS fix |
| **new** | A27: a PG student's UG aggregate is stored as **CGPA on the 10-point scale**, not a percentage. Cheap to reverse now |

---

## 8. First commands in a new session

```bash
cd ~/fpc-pms
export PATH="$HOME/.npm-global/bin:$PATH"   # pnpm lives here
pnpm install
pnpm test:run        # expect 949 passing across 77 files
pnpm test:e2e        # expect 1 journey passing
pnpm dev             # localhost:5173
```

Ship with `pnpm db:push` (migrations) then `pnpm deploy` (Cloudflare). Both were
run this session; **neither is automatic** — committing does not deploy.

Git is **local only**, no remote. 61 commits, working tree clean.
