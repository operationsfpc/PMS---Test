I am learning course on LLMs today. This is Tinker LLM course designed by Kalviyam.# UAT Feedback — 20/08 round (from `docs/inbox/Meetings Tracker .pdf`, pages 11–17)

**Status: ✅ SHIPPED 2026-08-20.** All seven groups live — Cloudflare version
`32e3954e-eb2c-48e6-ba1e-370a83a9a842`, JS byte-identical to `dist/`
(962 446 bytes, sha256 `bc6d012d…`), remote migrations at **0055**. Suite:
3394 tests / 173 files, `pnpm check` exits 0, Playwright journey passes.
G4 executed live: student row `Sai Naveen` (roll "123",
sainaveen@faceprep.in) had ZERO dependent rows; student row + its
student-only auth user deleted in one transaction, 0 rows left. 0055's freeze
proved against production: a venue change on a round with recorded results
was refused by the trigger (rolled back).
G6a root cause: the Advance button only rendered when someone was already
marked Selected — it now stands disabled with instructions, so it can never
read as missing again.

| Q | Answer |
|---|---|
| Q1 (G1d archive) | **1a** — collapsed "Expired" section on the same list |
| Q2 (days-pending) | **as recommended** — flag after 3 days |
| Q3 (reject dialog) | **confirmed** — required reason |
| Q4 (Sai Naveen) | **ok** — locate on live, report dependents, wait before deleting |
| Q5 (freeze trigger) | **a** — first attendance/result recorded |
| Q6 (notifications nav) | **a** — sidebar item |
| Q7 (drill-through) | **b** — build `/students/:id` canonical page |
| Q8 (round modes) | **go ahead** — Online · Physical — on campus · Physical — outside campus, Link ↔ Venue |

Source: "PMS Feedback - 20/08" section of the Meetings Tracker document,
copied to `docs/inbox/Meetings Tracker .pdf` on 2026-08-20.

---

## The items

### G1 — DH / Central CPC "Yet to Publish" list (4 asks)

- **G1a — "Raised on" date stamp** on every drive card, plus a **"days
  pending"** flag for anything sitting too long.
- **G1b — Sort by status/age** — "oldest submitted first" to clear a backlog.
- **G1c — Approve/reject directly from the list** — today every drive needs a
  click into "View drive" even for the one action the screen exists for.
- **G1d — Auto-archive expired drives** — once the application deadline
  passes, the drive should stop cluttering the active list.

Current state: the cockpit (`src/features/central-cpc/cockpit-*`) orders by
`created_at` descending, shows no date, and carries no list-level actions.

### G2 — Required-field markers on the PIF

No way to tell mandatory from optional fields; incomplete PIFs can be
submitted and reach the Delivery Head with thin company data.

Plan: mark required fields with `*` (and an "optional" tag where clearer),
and make submit refuse until the required set is complete — field-level inline
errors already exist from the 18/08 round; this extends the required set and
its visual marking. Single source of truth: `pifSubmitSchema`.

### G3 — Student notifications: dedicated page reachable from navigation

The dashboard preview block exists, and `/student/notifications` shipped
19/08 — but nothing in the sidebar reaches it. Ask: a "Notifications"
sidebar item (or bell icon) with a **full, filterable log**.

### G4 — Data: remove Sai Naveen from the student database

He is the current campus placement coordinator and was added as a student.
Live-data deletion — needs his exact identifier and a check for dependent
rows (applications, offers, semesters) before running.

### G5 — Central CPC shortlisting (3 asks)

- **G5a — Show the student's actual skills**, not just
  "Scored on 0 of 1 required skills" (`src/domain/ranking.ts` reason line).
- **G5b — Distinguish drives in the shortlisting list**: add raised-on or
  applications-close date, plus role/CTC beside each drive name.
- **G5c — Group/filter by age/status** — collapse or de-prioritise
  "applications closed" drives (e.g. the Dummy Drives) so the working list
  stays on active drives.

### G6 — Central CPC rounds & results (3 asks)

- **G6a — "Advance to Round 2" button missing** — reported no way to progress
  a candidate. ⚠️ The advance dialog shipped on 19/08 (`8451678`/`d05a7aa`);
  this may be feedback against the pre-ship build or a specific state
  (e.g. a drive with no shortlist). Reproduce on live before building.
- **G6b — "Venue" instead of "Link" for physical rounds** — when mode is
  "Physical, outside campus" the field still says "Link"; it must take an
  address.
- **G6c — Freeze round details once students begin participating** — details
  are editable even after a drive completes and a student is selected. 19/08's
  F4 made rounds editable post-creation; this bounds it: editable until
  participation starts, frozen after.

### G7 — Central CPC student records: clickable counts

Student numbers/counts aren't clickable; no way to drill into student
details from that view.

---

## Clarifying questions (numbered — answer by number)

- **Q1 (G1d)** — "Archive" meaning: (a) a collapsed "Expired" section at the
  bottom of the same list, or (b) moved to a separate Archived tab, or
  (c) hidden entirely? Recommendation: (a) — nothing is destroyed, the
  active list stays clean.
- **Q2 (G1a)** — "Days pending" flag threshold: flag anything pending more
  than how many days? Recommendation: 3 days.
- **Q3 (G1c)** — Reject from the list will require a reason (same rule as
  everywhere else): a small dialog with a required comment. Confirm.
- **Q4 (G4)** — Sai Naveen's exact email/roll number as stored, so the right
  row is removed. If he has applications or offers attached I will report
  them and wait for your confirmation before deleting.
- **Q5 (G6c)** — Define "students begin participating": (a) the first
  attendance/result is recorded in any round, or (b) the round's scheduled
  time has passed? Recommendation: (a) — a recorded fact is unambiguous;
  a schedule can be postponed.
- **Q6 (G3)** — Navigation form: (a) sidebar item "Notifications", or
  (b) bell icon in the header, or (c) both? Filters proposed: unread/read +
  type. Recommendation: (a) for now — the sidebar is the student's
  navigation habit; a bell can come with the header redesign.
- **Q7 (G7)** — Drill-through target: clicking a count opens (a) the filtered
  student list (exists today), or (b) a per-student record page
  `/students/:id` (N1's second canonical page — not yet built). (a) is a
  small change; (b) is a new page that would also serve several other
  screens. Recommendation: (a) now, (b) as its own item.
- **Q8 (G6b)** — Round mode becomes a picklist: Online · Physical — on
  campus · Physical — outside campus, with the conditional field switching
  Link ↔ Venue. Confirm these three values (or give the exact set).

---

## Build order (once approved)

1. G6a reproduction on live (may already be fixed) + G6b venue/link + G6c
   freeze — rounds correctness first, it guards a running process.
2. G1a/G1b/G1c/G1d — cockpit list upgrades.
3. G2 — PIF required markers + submit gate.
4. G5a/G5b/G5c — shortlisting visibility.
5. G3 — notifications navigation + filters.
6. G7 — clickable counts.
7. G4 — live data removal (with confirmation of dependents).

Each item TDD: failing test → minimum code → refactor; ship and verify at
the end.
