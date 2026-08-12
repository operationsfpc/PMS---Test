# Spec — Workflow simplification: grouped navigation + full post-shortlist cycle

**Date:** 2026-08-12 · **Status: AWAITING APPROVAL**
**Source:** Karthik's message of 2026-08-12 + screenshot
(`docs/inbox/Screenshot 2026-08-12 at 6.32.54 PM.png`) + ten answered questions.
**Mockup:** `docs/specs/2026-08-12-sidebar-mockup.html` — approve before build.

---

## Confirmed decisions (from the interview, 2026-08-12)

| # | Decision |
|---|---|
| D1 | Grouped sidebar (heads + sub-heads) applies to **every role** |
| D2 | PIF approval **stays with the Delivery Head**. The Central CPC only publishes after DH approval, and must see **yet-to-publish** and **published** drives separately |
| D3 | SRF verification and certificate verification are **campus CPC only** — removed from the Central CPC, in the UI **and** server-side. Client accepts that an empty campus-CPC seat halts verification and will keep the role filled. (Verified live 2026-08-12: `ashokkumar091293@gmail.com` is an active campus CPC, mapped to SDNB Vaishnav College for Women, not on the student roster) |
| D4 | Shortlist export: **CSV that Excel opens** (BOM-prefixed). No new dependency; P2 stays open |
| D5 | **REVERSAL of PRD §16.2 / domain-model §7:** an approved self-placed offer now **enters the category ladder**, exactly like an on-campus offer. Same ladder semantics (blocks equal and lower categories, allows higher) |
| D6 | The approving coordinator **must select the offer category** when approving a self-placed offer. Mandatory — no category, no approval |
| D7 | An opted-out student who applied but is **not yet shortlisted** cannot be shortlisted. Shown as an **alert**; the Central CPC may **override** (explicitly, with a reason). A student already **mid-round completes it** |
| D8 | **Recruiters are not users.** The Central CPC enters all recruiter decisions on their behalf; that entry is final and **triggers communication** to students on shortlisting and round clearance. (Supersedes Q9's "recruiter chooses round-1 participants" — the Central CPC records that choice) |
| D9 | Notifications are **in-app only** for now; email later (P1 unchanged) |
| D10 | Campus CPC gets **read-only full-cycle visibility** for their campus's students — shortlist status, round progress, attendance, offers — through to offer made |

---

## Workstream 1 — Grouped sidebar, every role

`ROLE_NAVS` becomes groups: `{ heading, items[] }`. Order below is the order on
screen. No route is renamed unless stated; this is navigation structure, not a
rewrite of working screens.

### Central Placement Coordinator
| Head | Items |
|---|---|
| **Drives** | Yet to publish · Published · All drives |
| **Publish a drive** | Publish and target · Skill repository *(view-only reference)* |
| **Drives in progress** | Shortlisting · Rounds & results · Attendance · Final selection |
| **Requests** | Opt-out requests · Off-campus offers |
| **Overview** | Placement overview |

Removed: **Certificate verification** (D3). "Drive cockpit" is absorbed:
*Yet to publish* is the cockpit filtered to `approved`-but-not-live (complete
fields, set window/rounds, publish); *Published* is `live` and later statuses.

### Campus Placement Coordinator
| Head | Items |
|---|---|
| **Verification** | Student verification *(rename of "Verification queue")* · Certificate verification |
| **Drives in progress** | Drive progress *(NEW, read-only — D10)* · Attendance |
| **Requests** | Opt-out requests · Off-campus offers |
| **Overview** | Campus overview |

### Student
| Head | Items |
|---|---|
| **Home** | My dashboard *(notifications land here — WS6)* |
| **Drives** | Open drives |
| **My record** | My registration form · My profile |
| **Requests** | Opting out · Off-campus offer |

(*My profile* was previously reachable only via a dashboard link.)

### Account Executive
| Head | Items |
|---|---|
| **Drive initiation** | Position information form |
| **My drives** | My drives · Drive cockpit |

### Delivery Head
| Head | Items |
|---|---|
| **Drive approval** | PIF approvals |
| **Drives** | My drives · Drive cockpit |
| **Overview** | Placement overview |

### Admin
| Head | Items |
|---|---|
| **Organisation** | Campuses · Staff · Import roster |
| **Overview** | Placement overview |

CM / KAM / ER / ER Head / CEO: single **Overview** head, items unchanged.

---

## Workstream 2 — Publish pipeline split (Central CPC)

- **Yet to publish** — drives at `approved` (DH has approved, Central CPC has
  not published). Each row: what is still missing before it can go live
  (window, rounds, vacant fields), straight into the existing cockpit/publish
  flow.
- **Published** — `live`, `applications_closed`, `in_rounds`, `completed`.
  Each row: status, window, applicants count, link into Drives-in-progress.
- No migration. Two filtered views over existing data.

---

## Workstream 3 — The blocker: the category ladder is not enforced

Found and confirmed 2026-08-12, three defects, all fixed with failing tests
first:

1. **`drives-view.ts` selects a non-existent column** (`offers.status`).
   PostgREST refuses the whole query, the error is swallowed, and the ladder
   always sees "never placed". Regression test via `query-contract.test.ts`
   (register the select) + a failing unit test.
2. **The select omits `source` (and `declared_at`, `ctc_lpa`)** — even fixed,
   the domain's on-campus filter sees `undefined` and drops every offer.
3. **No server-side guard on `applications` insert** — the ladder ran only in
   the browser. New migration: a trigger that refuses an application when:
   - drive not `live`, or `now()` outside the application window
   - student not `srf_approved`, or participation not `active`
   - the **category ladder** blocks it (existing offers at equal/higher rank —
     including approved self-placed offers, per D5)
   - the **internship cap** is consumed (for internship-type drives)
   - the drive targets campuses and the student's campus is not among them
   - `open_to_all_override` bypasses ladder + cap only, exactly as R5a.
   Academic eligibility (R2: CGPA/marks/arrears cutoffs) stays a Layer 0
   decision surfaced in the UI; the trigger enforces the gates that protect
   *other people's* opportunities.

---

## Workstream 4 — Self-placed offers enter the ladder (D5, D6)

- **Domain** (`src/domain/offers.ts`): the ladder (`highestOfferCategory`)
  now counts approved self-placed offers **with a category**. Deliberately
  split from `placementOffers`:
  - R9 placement record and placement statistics stay **on-campus only** —
    self-placed remains a separate reporting line (PRD §16.2's reporting half
    is NOT reversed).
  - Internship cap: a self-placed offer does **not** consume it.
    ⚠️ ASSUMPTION — flag in `docs/ASSUMPTIONS.md`, cheap to reverse.
- **Schema** (migration): restore `offer_category not null` for self-placed
  ladder offers (tightening what 0014 relaxed). Live `offers` count is 0
  (checked before writing this spec) — no backfill.
- **UI**: the off-campus approval form (campus CPC + Central CPC queues) gets
  a **mandatory category selector** (Regular / Dream / Super Dream), suggested
  from the CTC bands but chosen by the coordinator (D6).
- **Student-facing**: `/student/drives` explains the block:
  "Placed at Dream via your off-campus offer — only Super Dream drives are
  open to you."

## Workstream 5 — Opt-out rules (D7)

- Shortlisting screen: an opted-out applicant is flagged with an alert,
  excluded by default, and can only be included through an explicit override
  that captures a **reason** (stored on the shortlist entry, audit-logged).
- Server-side: trigger refuses `included = true` for an opted-out student's
  application without an override reason.
- Mid-round: a student already scheduled in a round completes it; they are
  never scheduled into the next round after opt-out approval (no override at
  the round level — the override exists only at shortlisting).
- Notifications: **never** written to opted-out students (enforced where
  notifications are written, WS6).

## Workstream 6 — The full round cycle + in-app notifications (D8, D9)

The `notifications` table (0006) has never been written or read. This makes it
real:

**Flow** (Central CPC enters everything; each entry is final and communicates):

1. **Publish** defines numbered rounds (already exists — 0032 + publish
   screen). Rounds can be added mid-drive (A24, exists).
2. **Shortlist saved** → for each *newly included* application:
   - notification: "You are shortlisted for {company}"
   - scheduled into **Round 1** (`attendance` row, `scheduled`).
3. **Rounds & results** (rebuilt screen, per drive → per round):
   - each round numbered, with its scheduled students
   - record result: selected / rejected / waitlisted / on_hold
   - **"Advance selected to Round N+1"** — explicit button, schedules the
     `selected` into the next round + notification: "You cleared Round N of
     {company} — Round N+1 next".
   - attendance stays markable (existing attendance screen, both CPCs).
4. **Final selection** (existing offer screen) → offer row + notification:
   "Offer from {company} — {category}".
5. **Student dashboard**: notifications panel (unread badge, mark-as-read),
   and the existing per-application round progress — now actually fed,
   because scheduling rows exist.

**Written by Postgres triggers**, not application code (same rationale as
audit): shortlist inclusion, round result `selected`, offer insert. Trigger
skips opted-out students (WS5).

⚠️ ASSUMPTION (cheap to add): a **rejected** round result produces no
notification; the student sees the outcome on their dashboard. Only
progressing students are actively notified ("progressing students know the
results").

**"Data not reflecting" root cause** to verify during build: nothing ever
created `attendance`/`round_participants` rows after shortlisting, so the
student dashboard and the results screen read from empty tables. WS6 step 2
is the fix.

## Workstream 7 — Verification is campus-CPC-only (D3)

- Nav: gone from Central CPC (WS1).
- Server-side (migration): SRF decisions (`srf_status` →
  `srf_approved`/`srf_rejected`) and certificate decisions
  (`student_certificates` UPDATE) require `campus_placement_coordinator`,
  campus-scoped. The Central CPC's write is refused with a named error.
- Routes `/cpc/verification` and `/cpc/certificates` refuse the Central CPC.
- ⚠️ Consequence (accepted): if the campus CPC seat is empty, verification
  halts until an Admin fills it. The client keeps the seat filled.

## Workstream 8 — Shortlist CSV export (D4)

- "Export shortlist (CSV)" button on the shortlisting screen: the included
  students, BOM-prefixed CSV so Excel opens it with correct encoding.
- Every export writes a `recruiter_exports` row (PRD §13.2 data-sharing log)
  — table exists, never written.
- Columns from the **application snapshot** (never the live profile): name,
  roll number, degree, branch, CGPA, contact, resume link.

## Workstream 9 — Campus CPC drive progress (D10)

- New read-only screen `/cpc/drives`: every drive that touches their campus's
  students — their applicants, shortlist status, per-round attendance +
  results, final offers. Strictly read-only; RLS already scopes
  `applications`/`offers`/`attendance` via `my_student_ids()`; add read
  policies only where a table refuses campus readers today (checked at build).

---

## Order of work

| # | What | Ships |
|---|---|---|
| 1 | WS3 + WS4 — ladder enforced end to end (blocker) | migration + deploy |
| 2 | WS1 + WS2 + WS7 — navigation, publish split, verification narrowed | migration + deploy |
| 3 | WS6 + WS5 — rounds cycle, notifications, opt-out guard | migration + deploy |
| 4 | WS8 + WS9 — CSV export, campus CPC visibility | deploy |

Each stage: red → green → refactor, `pnpm check` green, `pnpm db:push` +
`pnpm deploy`, live verification, `SHIPPED:` line. Playwright student journey
updated when the apply flow changes.

## Out of scope (unchanged)

Email delivery (P1) · XLSX export (P2 — CSV per D4) · recruiter portal ·
WhatsApp · compliance module.
