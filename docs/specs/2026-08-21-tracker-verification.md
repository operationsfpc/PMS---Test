# Meetings Tracker — full verification audit (2026-08-21)

Source: `docs/inbox/Meetings Tracker  (1).pdf` (all 20 pages, every date).
Method: each ask checked against the **code** (grep/read), not against session
notes. Legend: ✅ done · 🟡 partial · ❌ not done · ⏸ deferred by decision ·
🔁 superseded by a later decision of Karthik's.

---

## Page 1 — "PMS Enhancement Requests" (earliest, undated)

| # | Ask | Status | Evidence |
|---|---|---|---|
| 1 | Profile auto-populates real CSV data, not dummy | ✅ | Profile reads the live `students` row (`profile-repository.ts`) |
| 2 | **"Phone Number" mandatory column (10-digit) in the student CSV upload template** | ❌ **NOT DONE** | `ROSTER_COLUMNS` = roll_number, name, email, degree, branch, passing_year — no phone. Mobile is collected later via the SRF (10-digit, 6–9 validation). Decision needed: add to the roster template, or accept the SRF as the collection point |
| 3 | Alternate mobile mandatory on profile | ✅ | SRF completeness requires `alternateContact` (`srf-progress.ts:77`) |
| 4 | Semester-wise CGPA, UG and PG separately | ✅ | `student_semesters`; UG ≤10 lines, PG = UG aggregate + ≤4 lines; eligibility judged on latest VERIFIED semester |
| 5 | Max file size + formats on every upload field | ✅ | Shared `UPLOAD_LIMITS` — "PDF only, up to 5 MB" (`components/form.tsx`) |
| 6 | **Master resume + AI-generated role-specific resumes** | ⏸ **Phase 2 — confirmed deferred** (recorded decision). Current design: one resume per role area, uploaded at SRF (0049) |
| 7 | PIF field-level inline errors | ✅ | Inline per-field messages; required markers added 20/08 (G2) |
| 8 | Approved PIFs persist under the DH | ✅ | `approved_by`/`approved_at`; DH cockpit + portfolio show them |
| 9 | Cockpit for DH and AE | ✅ | Recorded decision; DH full cockpit; AE sees own drives (0008 rule: an AE cannot see other AEs' drives) |
| 10 | Login/logout for every role | ✅ | Long fixed; verified across roles in the journey test |
| 11 | Publish button functional | ✅ | Publish-and-target works; drives go live daily in UAT |

## Page 2 — 18/08 (Abhishek)

| # | Ask | Status | Evidence |
|---|---|---|---|
| 12 | JD PDF attached to drive | ✅ | 0051; student card offers a signed short-lived link |
| 13 | Shift timings as IST time fields | 🔁 Superseded by Karthik's J2 decision (same day): Day/Night/Rotational/Flexible radio + night-timing text. Not free text any more; not Abhishek's exact shape |
| 14 | Joining timeline dropdown + comment | ✅ | J3 — Immediate/Later + per-option comment |
| 15 | Bond fields not mandatory | ✅ | Optional |
| 16 | One PIF for multiple designations | ✅ | F7 `additional_designations` |
| 17 | Date field hyphen/slash confusion | ✅ | Native date pickers throughout |
| 18 | **Zoho auto-fetch of PIF** | ⏸ **Spec approved (Design A, zoho.in), Zoho admin has the checklist — WAITING FOR KARTHIK'S GO** |
| 19 | Role model: KAM campus-view only; CPC sole publisher | ✅ | `is_campus_reader` read-only; publish is Central CPC's alone (0047). "One ERT/KAM person coordinates" is org practice, not software |
| 20 | Placed students cannot see new drives | 🔁 Superseded: the ladder keeps HIGHER categories open (19/08 C2, tightened 21/08 Q1b) |

## Pages 3–10 — 19/08

| # | Ask | Status |
|---|---|---|
| 21 | Job type first on PIF | ✅ A1 |
| 22 | Conditional compensation (stipend/CTC by type) | ✅ A2 |
| 23 | Reordered company-details section | ✅ A3 |
| 24 | Company contacts; CPC default when blank | ✅ A4/A5 (all contact fields optional per Q2 answer; no-contact alert names the CPC default) |
| 25 | "+" multiple contacts | ✅ |
| 26 | Drafts clear after publish | ✅ B1 |
| 27 | Every drive button clickable | ✅ B2 (every card opens `/drives/:id`) |
| 28 | Old drives for disqualified students — "needs design decision" | ✅ Resolved by the four-list student screen (N7): closed drives move to "Not applied · closed" / "Applied · closed" with the outcome stated |
| 29 | Publish view: role/comp prominence | ✅ Restyled |
| 30 | Thanush shown Not Placed | ✅ C1 |
| 31 | Higher categories open after placement | ✅ C2 + 21/08 Q1b |
| 32 | Distinguish duplicate company entries | ✅ C3 (role + CTC + dates on cards) |
| 33 | Drives match job-type preference | ✅ D1 (0054, both layers) |
| 34 | Auto-fetch preferred resume + skills at apply | ✅ D2 |
| 35 | Profile updates: forward-only; campus-manager approval | ✅ forward-only (R7 snapshot) · 🔁 approval: Karthik's Q6 answer — "No approval. Change applies to future drives immediately" |
| 36 | Manual shortlist count | ✅ D6 — advisory "Target shortlist size" input |
| 37 | Skill repository sticky headers | ✅ D7 — sticky `<thead>` |
| 38 | Show actual skills in shortlisting AND at publish | 🟡 Shortlisting ✅ (skill chips, x/5); drive record page ✅ ("Must-have skills"); the publish screen itself does not repeat them inline |
| 39 | Bulk selection for shortlisting (checkbox + select all) | ✅ D9 — existed before today's rounds-page bulk work |
| 40 | Condensed notifications + Read More | ✅ E1 |
| 41 | Non-destructive read state | ✅ E2 (read sinks, never deletes) |
| 42 | Notification timestamps | ✅ E3 (IST dates) |
| 43 | Linear round advancement enforced | ✅ F1 (locked rows) |
| 44 | Confirmation before shortlist/reject | ✅ F2 (and 21/08: one confirmation per bulk action) |
| 45 | Proof-of-communication upload on advance | ✅ F3 (0053, private bucket) |
| 46 | Round details editable post-creation | ✅ F4 — until first recorded fact (0055 freeze, Q5a) |
| 47 | Meeting links per student / bulk CSV slots | ✅ F5 |
| 48 | Round schedule notifications | ✅ F6 — **in-app only; email deferred** (no provider yet) |

## Pages 11–17 — 20/08 (G1–G7)

All shipped 2026-08-20, migration 0055, verified then: raised-on dates +
pending flags + oldest-first sort + list-level approve/reject + expired
collapse (G1) · required markers + submit gate (G2) · notifications sidebar +
filterable page (G3) · Sai Naveen removed from live data (G4) · shortlisting
skills/identifiers/expired grouping (G5) · Advance button always present +
Link↔Venue by round mode + freeze-at-first-fact (G6) · clickable student
counts → `/students/:id` (G7). **All ✅.**

## Pages 17–20 — 21/08

Shipped today (0056, 0057): Dream-drive visibility root causes + cap
narrowed to plain internships (Q1b) + honest banner · off-campus venue
(PIF / CPC edit / student card) · plus the same-day verbal batches: bulk
round results, manage rounds, drive pickers, completion, absent alerts,
stage drill-through. **All ✅.**

---

## Karthik's decisions on the open items (2026-08-21, evening)

1. **CSV phone column — CLOSED.** SRF collection is acceptable; the roster
   template stays minimal.
2. **Master resume + AI — stays Phase 2.** Current rule confirmed: one
   resume per selected role area, and a resume MUST be attached for every
   area the student chose. (Already enforced: `missingResumesFor` blocks
   SRF submission until every selected area has its resume — PRD §4.1.)
3. **Zoho — on hold** (was "awaiting go"; now explicitly held).
4. **Skills on the publish screen — BUILT & SHIPPED** same evening:
   "Must-have skills: …" inline under the publish header, honest
   "No must-have skills declared on the PIF." when absent.
5. **Email server — later**, as before.
6. **Superseded items — confirmed OK** as decided.

## Summary — what a tester could legitimately flag as "not incorporated"

1. **❌ CSV phone column (page-1 item 2)** — roster template still has no
   phone column. Decision needed (template change vs SRF-collected).
2. **⏸ Master resume + AI (item 6)** — deferred to Phase 2 by recorded
   decision; per-role resumes are the current design.
3. **⏸ Zoho auto-fetch (18/08)** — designed and answered, build awaits go.
4. **🟡 Skills on the publish screen (item 38)** — shown at shortlisting and
   on the drive page, not inline on publish.
5. **📧 Email channel everywhere** (round schedules, absent alerts) — in-app
   only until an email provider is chosen (Gmail caps make PRD §21.2
   undeliverable; provider decision open).
6. **🔁 Three asks were consciously overridden by later decisions** — IST
   shift fields (→ J2 radio), placed-students-see-nothing (→ ladder),
   profile-update approval (→ Q6 "no approval"). If the tester expected
   these, the tracker's own later pages changed them.
