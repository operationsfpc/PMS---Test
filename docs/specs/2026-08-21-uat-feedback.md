# UAT Feedback — 21/08 round (from `docs/inbox/Meetings Tracker  (1).pdf`, pages 17–20)

**Status: 🟡 DIAGNOSED — awaiting answers to Q1–Q5 below before building.**

Source: "21/08 - PMS Feedback" section, copied to
`docs/inbox/Meetings Tracker  (1).pdf` on 2026-08-21.

---

## Item 1 — "Drives not reflecting in student view"

**Report:** A drive published under Dream does not appear in the student's
"To apply" list even though the student is placed under Regular, and the
banner explicitly says higher-category drives remain open. Tested twice
(HCL Dream ₹4–5 LPA, then LTI Mindtree Dream ₹6–7 LPA); neither reflected.

### Diagnosis (verified against the live database, 2026-08-21)

The test student is **TestShash** (`c35e70fa`), placed Regular via the
**Deloitte internship-convertible** drive. The two test drives were hidden
for **two different reasons — neither is a code defect**:

1. **HCL Technologies** (`624fb237`, Dream, **internship_convertible**) —
   hidden by the **internship cap** (R4, PRD §11). TestShash's Regular offer
   came from an internship-convertible drive, so the one-internship cap is
   consumed, and the cap is checked **before** the category ladder — a
   previously approved decision (Q2, recorded in
   `src/domain/visibility.ts`): *"a Super Dream internship-convertible drive
   is still hidden from a capped student."* Everything else passes: the
   student is eligible, has no area/drive-type preference gates, and
   Regular → Dream is strictly higher on the ladder. Had HCL been a plain
   **placement** drive it would have appeared.

2. **LTI Mindtree** (`f360819f`, Dream, **plain placement**) — hidden by
   ordinary **eligibility**: the drive is restricted to degree
   "B.Sc CS / CT", branch "AI and Machine Learning". TestShash is
   **BCA / AI and DS**. This is the test setup, not a product bug — R5
   deliberately drops ineligible drives entirely rather than showing a
   drive the student can never apply to.

### The real product problem

The banner *"You are placed — Regular. Drives in higher categories remain
open to you…"* promises the ladder **unconditionally**, but for a student
whose placement consumed the internship cap, every internship /
internship-convertible drive stays hidden regardless of category. The
promise and the behaviour disagree — that is what the tester saw.

### Questions (blocking)

- **Q1 — Cap vs ladder for convertible-placed students.** A student placed
  via an internship-convertible offer: may they still see and apply to
  **higher-category internship-convertible** drives?
  - **(a) Keep the cap as decided (Q2, 2026-08-12):** one internship per
    tenure, full stop. Higher-category *placement* drives remain open;
    convertible/internship drives do not. → Fix is messaging only (Q2 below).
  - **(b) Relax it:** the cap should only block **plain internship** drives;
    a *strictly higher-category convertible* drive is primarily a placement
    upgrade and stays open. → Domain + 0054 trigger change, both sides.
  - My read: **(a)** is defensible and already client-approved once; but the
    tester's expectation and the banner both suggest the business now wants
    **(b)**. Recommend putting (b) to the client explicitly.
- **Q2 — Banner honesty.** Whatever Q1 decides, the placed-banner should
  state the internship-cap consequence when it applies, e.g. *"You are
  placed — Regular (internship-convertible). Higher-category placement
  drives remain open to you; internship drives are closed because the
  one-internship allowance is used."* Confirm wording, or supply preferred
  wording.
- **Q3 — Tester communication.** LTI Mindtree was hidden by its own
  degree/branch restrictions (B.Sc CS-CT / AI-ML vs the student's BCA /
  AI-DS). No change proposed — confirm it's enough to report this back to
  the tester, or should eligibility-hidden drives be surfaced somewhere for
  testers/CPCs (e.g. an "eligibility check" tool)?

---

## Item 2 — PIF: no venue field for off-campus drives

**Report:** When an AE marks a drive as off-campus there is no field to
capture the venue.

**Requirement (from the document):**
- Add a **Venue** field to the PIF, applicable when drive mode is
  off-campus.
- Include a **"Venue not yet confirmed"** option so the AE isn't blocked
  from submitting.
- The **Central CPC** must be able to update the venue **post-submission**
  once the company confirms it.

### Current state

- `drives.drive_mode` enum: `on_campus · physical_outside_campus · virtual ·
  pooled`. The PIF's "Physical drive outside campus" maps to
  `physical_outside_campus`.
- The `drives` table has **no venue column** (0004's `venue` lives on
  *rounds*, used since G6b for per-round venues).
- Post-submission edits by the Central CPC are already possible at the RLS
  level (`drives_operator_update`), but the PIF UI freezes after submit.

### Proposed shape (pending Q4/Q5)

- New nullable `drives.venue text` + a `venue_confirmed boolean` (or a
  single nullable text where `null` = not yet confirmed — leaning to the
  latter: one fact, one column; "Venue not yet confirmed" is the *absence*
  of a venue, not a venue).
- PIF: when mode = "Physical drive outside campus", show a Venue block with
  a radio — **"Venue confirmed" + text input** / **"Venue not yet
  confirmed"**. Submit allowed either way.
- CPC: venue editable from the drive view after submission (audit-logged
  like every mutation); the round-freeze rule (0055) does not apply — this
  is the *drive* venue, not a round venue.
- Student card "Where and when": show the venue when present, "Venue to be
  confirmed" when the mode is off-campus and it is absent.

### Questions (blocking)

- **Q4 — Scope of "off-campus".** Venue field for
  **physical_outside_campus only**, or also for **pooled** drives (which
  happen at another campus's venue)? Recommend: both.
- **Q5 — Who else may edit the venue post-submission?** The document names
  the Central CPC. The AE raised the drive and talks to the company too —
  may the AE also update it while the drive is not yet completed?
  Recommend: Central CPC only, per the document, matching
  "one verb one role" (0047).

---

## Housekeeping noted this round

- `docs/specs/2026-08-20-uat-feedback.md` had an unrelated stray first line
  ("I am learning course on LLMs today…") — removed 2026-08-21.
