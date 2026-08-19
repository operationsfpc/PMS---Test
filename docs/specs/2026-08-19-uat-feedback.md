pues# UAT Feedback — 19 Aug 2026

**Source:** Meeting transcript + `Meetings Tracker .docx` (section dated 19/08).  
**Answers confirmed:** See session notes above.  
**Status:** ✅ APPROVED ("go in that order") — **BUILT AND SHIPPED 2026-08-20.**
All P1–P5 items live. Migrations 0053+0054 pushed. See HANDOVER.md.
Deviations from this spec, agreed by construction:
- D2 relaxed F14: the saved per-area resume is the default, the drive upload
  is the optional override (a student with neither is still refused).
- F2 on the results screen confirms `selected`/`rejected` only — the two that
  notify the student; interim states record without ceremony.
- F6 shipped as in-app notifications via DB triggers (0054); the student's
  In-progress card does not yet repeat the schedule (noted as follow-up).

---

## Decisions recorded from Q&A

| # | Question | Answer |
|---|---|---|
| Q1 | Stipend format | Monthly ₹/month, min + max range |
| Q2 | Contacts required? | All optional. If none, CPC is default POC |
| Q3 | "Only button clickable" — which screen? | Central PC's cockpit |
| Q4 | Self-placed disqualification scope | Ladder-blocked, system-wide (existing behaviour confirmed) |
| Q5 | Job-type override button | Dropped — do not build |
| Q6 | Profile update approval? | No approval. Change applies to future drives immediately |
| Q7 | Proof upload granularity | One optional file for the whole advance action |
| Q8 | Meeting link options | Support all: shared round link + per-student link + CSV bulk upload |

---

## Change groups

### Group A — PIF form restructuring

**A1 — Drive type moves to the top of the form**

Currently in Section 4 (Selection process). It now becomes the FIRST card,
before Company details. The type is the load-bearing choice: it determines
which compensation fields appear, how the drive is classified, and which
students can see it. An AE who fills in a full CTC and only then discovers it
was an internship has wasted the session.

New card order:
1. Drive type ← new first card (single radio: Placement / Internship / Internship-convertible)
2. Company details
3. Role details (reordered — see A3)
4. Eligibility criteria
5. Selection process and timeline

**A2 — Conditional compensation field**

Immediately after drive type selection, a compensation block appears:

| Drive type | Fields shown |
|---|---|
| `placement` | Min CTC (LPA) · Max CTC (LPA) · CTC breakup |
| `internship` | Stipend min (₹/month) · Stipend max (₹/month) |
| `internship_convertible` | Stipend min · Stipend max · Min CTC (LPA) · Max CTC (LPA) · CTC breakup |

Stipend fields: integer, ₹/month, range (max optional).  
New schema columns: `stipend_min_monthly int nullable`, `stipend_max_monthly int nullable` on `drives`.  
Existing CTC columns unchanged.  
Validation: if drive type is `internship`, CTC fields are not required (schema currently
requires `ctcMinLpa` on submit — this relaxes for internship only).

**A3 — Reordered Role details section**

New field order within "Role details":

1. Role title (+ additional designations block)
2. Role category
3. Number of openings
4. Work location(s)
5. Job description text + JD PDF attachment  
6. Shift
7. Bond / service agreement

Compensation moves out of this section into the new conditional block (A2).
Eligibility fields (CGPA, arrears, 10th/12th %, passing years, mandatory skills)
stay in their own "Eligibility criteria" section.

**A4 — Multiple contacts via "+" button**

Replace the single SPOC block (spocName / spocDesignation / spocEmail / spocPhone)
with a dynamic contact list — same pattern as `additionalDesignations`.

Each contact row: Name · Designation · Email · Phone (all optional per row).
"+" button adds a contact row. "Remove" button on each row.
No minimum — all contacts optional (Q2).

Schema: new `drive_contacts` table:
```
drive_id  uuid fk drives not null
sequence  int  not null
name      text
designation text
email     text
phone     text
pk (drive_id, sequence)
```
`spoc_*` columns on `drives` kept for now (backward-compat) but no longer
written by new form submissions. They are dropped in a later migration when
all live drives have been migrated.

**A5 — Alert if no contact added**

On the contacts card, if the list is empty: show an inline info banner:
"No contact added — the Central Placement Coordinator will be the point of
contact for this company."

This banner appears on the PIF form AND on the canonical `/drives/:id` page
(AE, DH, CPC views).

---

### Group B — Drive management bugs

**B1 — Drafts not clearing after publish**

Once a drive reaches `submitted` or beyond, it must NOT appear in the AE's
draft list (PIF page that re-opens a draft). The My Drives view for AEs and
the "Yet to publish" cockpit view for CPCs/DH should only show `draft` drives
as editable drafts.

Root cause to confirm: does the drives query for the AE drafts include
`submitted`, `approved`, `live`, etc.? If so, filter to `draft` only.

**B2 — Central PC cockpit: all cards navigable**

"Complete and Publish" is the only action link rendered for many cards.
For drives in any status that have no current action (e.g., `submitted`
waiting for DH approval, or `in_rounds` with rounds already linked), there
is currently NO clickable element on the card.

Fix: add a "View drive →" link on every cockpit card pointing to `/drives/:id`.
This makes every card navigable regardless of status, and is consistent with
N1 (the canonical drive record page shipped 2026-08-19).

---

### Group C — Student placement status

**C1 — Placed student shown as "Not Placed" (Thanush)**

Bug: a student with an approved self-placed or on-campus offer still appears
under "Not Placed" in the All Students view.

Root cause: the students query that determines placement status may be
filtering on `offer_source = 'on_campus'` only, or may not be joining the
`offers` table at all, or the `offer_category` is null (self-placed offers
require the CPC to set the category — if it is NULL, `highestOfferCategory`
returns null and no placement is recorded).

Fix: investigate the live offers row for Thanush. If `offer_category` is null
on the self-placed offer, remind the CPC to classify it. Ensure the students
view joins offers and counts any approved offer (regardless of source) as
"placed."

**C2 — Placed students can apply for higher-rung drives**

Domain logic already handles this (`isDriveVisibleToStudent` → `placed_at_equal_or_higher`
only hides equal/lower, not strictly higher). The display bug: the student sees
a green "Placed" status and possibly a UI element that looks like a lock.

Fix: on the student's drive list, placed students should see their status
clearly (e.g. "Placed — Regular") alongside the drives they can still target
(Dream, Super Dream). Remove any lock icon or wording that implies they
cannot proceed.

**C3 — Distinguishing drives for the same company**

When a company appears multiple times in any drive list (cockpit, student
drive tabs, shortlisting selector), the display must distinguish entries.

Format: **Company Name · Role Title · CTC (or Stipend)**  
e.g. "HCL Technologies · Software Developer · ₹3.0–3.5 LPA"  
e.g. "HCL Technologies · IT Support Analyst · ₹3.0–3.2 LPA"

Apply to: cockpit cards · student To-apply tab · Applied-closed tab ·
shortlisting page drive selector · All Students view drive filter.

---

### Group D — Eligibility & shortlisting

**D1 — Student job-type preference → drive visibility**

Students should declare which drive types they are interested in
(Placement / Internship / Internship-convertible — multi-select).

Where captured: the student's profile / SRF preferences section.  
How it filters: `isDriveVisibleToStudent` gains a new gate (below role-category,
same level — a preference, not a sanction):

```
if student.driveTypePreferences is non-empty
and drive.driveType not in student.driveTypePreferences
  → { visible: false, reason: "drive_type_not_preferred" }
```

Empty list = no preference = sees all drive types (consistent with role-category behaviour).

Schema: new column `drive_type_preferences drive_type[]` on `students`
(or a separate `student_drive_type_preferences` table — TBD in migration).

`openToAllOverride` already bypasses area and ladder gates; it should also
bypass this preference gate (same logic layer).

**D2 — Auto-fetch preferred resume on apply**

`buildApplicationSnapshot` already picks the role-category-matching resume.
The UI should confirm to the student which resume will be submitted BEFORE they
confirm the application — show the file name in the Apply confirmation dialog.
No schema change needed.

**D3 — Profile preference changes apply forward only**

No approval required (Q6). Students can freely update area of interest / skills.
The change takes effect immediately for drive visibility (the list re-filters on
next load). Past applications are unaffected — they snapshot at apply time.

UI: add a one-line note on the preferences edit screen: "Changes apply to new
drives from this point. Past applications are not affected."

No domain-logic change needed (snapshots already isolate past applications).

**D4 — DROPPED** (per Q5)

**D5 — Self-placed students are ladder-blocked (system-wide)**

Confirmed as existing behaviour. The bug is only the display (C1). No code change
beyond C1.

**D6 — Manual shortlist count input**

On the shortlisting page, below the drive title: a number input "Target shortlist
size" (not enforced — advisory only). The page shows "N of [target] shortlisted"
when a target is set. No schema change — this is ephemeral state held in the
shortlisting session. (If persistence is wanted, add `shortlist_target int nullable`
to `drives` in a later migration.)

**D7 — Skill repository column headers freeze**

`/central/skills`: sticky `<thead>` with `position: sticky; top: 0; z-index: 10`.
CSS-only change.

**D8 — Required skills visible in drive view and shortlisting**

On `/drives/:id`: show `mandatory_skills` in the role details section (currently
not displayed).  
On the shortlisting page (`/central/shortlisting`): show `mandatory_skills` as
a chip list above the applicant table, with a note "Skills required for this drive."

**D9 — Bulk selection for shortlisting**

Checkbox column on the left of each applicant row. "Select all" checkbox in the
column header. Bulk actions bar appears when ≥1 student selected:
"Include [N] selected" · "Exclude [N] selected" (with confirmation — see F2).

---

### Group E — Notifications

**E1 — Condensed notification panel**

Student dashboard: show top 3 notifications (unread first, then newest-read).
If there are more: "Read all N notifications →" links to `/student/notifications`
(a new full-page alerts list — same data, all entries, no condensing).

**E2 — Non-destructive read state**

Marking a notification as read does NOT remove it from the list. It moves from
"unread" (highlighted) to "read" (muted), and sinks below unread items.
The "Mark read" button is replaced by a "✓ Read" label.

**E3 — Date on each notification**

Already rendered as `onDate(note.createdAt)` in the dashboard. If missing in
the new full-page list (E1), add it there.

**E4 — Notification stacking bug**

Bug: a new notification replaces existing ones rather than appending.  
Likely cause: the notification trigger uses `INSERT ... ON CONFLICT DO UPDATE`
(upsert on student_id+kind), or the query orders DESC by `created_at` but the
application re-initialises the state array on each load, or a join in the MSW
handler overrides the full list.

Fix: investigate the actual trigger for shortlist/result notifications.
Must use plain `INSERT`, not upsert. Each event is its own row.

---

### Group F — Rounds & selection process

**F1 — Linear round advancement enforced**

Once a student has a participant row in Round N (created by the advance action),
the result controls for earlier rounds must be **read-only** for that student.
A coordinator cannot record "selected" in Round 1 for someone already in Round 2.

Domain rule: `canEditRoundResult(participantRound, latestRoundForStudent) → boolean`  
Returns false when `latestRoundForStudent > participantRound`.

UI: result dropdowns for a student in an earlier round are replaced by a
disabled `<span>` showing the recorded result + "(advanced)".

**F2 — Confirmation before shortlist/reject**

Before saving a shortlist decision (include/exclude individual or bulk),
show a confirmation dialog:

Single: "Include [Student Name] in the shortlist for [Drive]? They will be
notified and scheduled for Round 1."  
Single exclude: "Exclude [Student Name] from [Drive]? This cannot be undone."  
Bulk: "Include [N] students in the shortlist? They will be notified."

Standard shadcn `<AlertDialog>`. One confirmation pattern for both shortlist
page and rounds results page.

**F3 — Proof-of-communication upload when advancing**

"Advance N selected to Round X" flow adds an optional step:
1. CPC clicks "Advance N selected" button.
2. Confirmation dialog opens, showing the N students being advanced.
3. Optional file upload: "Attach proof of company communication (PDF or image)".
4. CPC confirms → advance happens, file (if any) is uploaded to storage bucket
   `advance-proofs/<drive_id>/<from_round_id>-<timestamp>.<ext>`.
5. Path stored in new column `advance_proof_url text nullable` on `drive_rounds`
   (the FROM round).

Schema: add `advance_proof_url text nullable` to `drive_rounds`.
Storage: new bucket `advance-proofs`, private, PDF + image accept.

**F4 — Round details editable after creation**

Each round tab gains an "Edit round details" section (collapsed by default):
- **Mode**: On-campus / Virtual / Physical outside campus (select)
- **Scheduled at**: date + time input (IST display)
- **Interview link** (shared — for virtual rounds): URL input

These are saved to new columns on `drive_rounds`:
`round_mode text nullable`, `round_scheduled_at timestamptz nullable`,
`round_interview_link text nullable`.

Changes are persisted immediately (auto-save or explicit Save button — TBD at
mockup stage). Students see mode + date + shared interview link on their
In-progress drive card.

**F5 — Meeting link distribution for online rounds**

Three levels, applied in priority order:

| Level | Scope | Where set |
|---|---|---|
| Per-student | Individual participant | Manual entry per row OR bulk CSV |
| Shared | Whole round | F4's `round_interview_link` |

Schema: `meeting_link text nullable` + `participant_scheduled_at timestamptz nullable`
on `round_participants`.

CSV bulk upload format (two columns):
`roll_number, meeting_link, scheduled_at`
(ISO datetime for `scheduled_at`, timezone = Asia/Kolkata assumed).

UI: each row in the Round results table gains a "Meeting link" field (text
input, optional). A "Bulk upload CSV" button at the top uploads links + times
for the whole round in one pass.

**F6 — Round schedule notifications**

When the CPC saves round details (F4) or assigns a meeting link (F5), all
participating students receive an in-app notification:

"[Company] — Round [N] ([name]) is scheduled for [date] at [time]. [Mode.]
[Meeting link if virtual and shared.]"

Per-student link is sent per-notification (each student receives their own link).
Email integration is Phase 2 — portal alerts only in this sprint.

---

## Migration sequence

| Migration | Contents |
|---|---|
| 0053 | `drives.stipend_min_monthly`, `drives.stipend_max_monthly`; `drive_contacts` table; `drive_rounds.round_mode`, `.round_scheduled_at`, `.round_interview_link`, `.advance_proof_url`; `round_participants.meeting_link`, `.participant_scheduled_at` |
| 0054 | Student job-type preference (`students.drive_type_preferences drive_type[] default '{}'`) + RLS; visibility rule update |

Both with pgTAP tests before shipping.

---

## Build order (Priority 1 → 4)

**P1 — Bugs, ship first:**
E4 (notification stacking) · C1 (Thanush not placed) · B1 (drafts clearing) · B2 (cockpit link)

**P2 — UI-only, no migration:**
E1/E2/E3 (notification panel) · D6 (shortlist count) · D9 (bulk selection) ·
F1 (linear advancement) · F2 (confirmation) · D7 (column freeze) ·
D8 (skills visible) · C2 (placed display) · C3 (company distinguishing) ·
D2 (resume name in apply confirmation) · D3 (forward-only note)

**P3 — PIF restructure (UI-only, no migration for section reorder):**
A1 (drive type first) · A3 (reordered role fields) · A5 (no-contact alert)

**P4 — Needs migration 0053:**
A2 (stipend fields) · A4 (multiple contacts) · F3 (proof upload) ·
F4 (editable round details) · F5 (meeting links) · F6 (round notifications)

**P5 — Needs migration 0054:**
D1 (student job-type preference)

---

## Items explicitly NOT in scope

- D4 (job-type override button) — dropped per Q5
- WhatsApp / email alerts — Phase 2
- JD PDF export — not in 19/08 feedback; deferred
