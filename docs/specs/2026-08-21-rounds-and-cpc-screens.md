# Spec — Rounds bulk advancement + Central CPC screens (21/08, batches B & C)

**Status: 🟡 APPROVED IN PRINCIPLE — mockups awaiting sign-off, then build.**

Decisions (Karthik, 2026-08-21): **1 ok · 2 ok · 3 b · 4 ok · 5 b**

---

## Batch B — rounds & results screen rework

### B1 — Bulk result recording (answer 1)

- Checkbox beside every undecided participant. Rows already advanced or
  locked show no checkbox.
- **"Select all undecided" / "Clear"** helpers above the list — they only
  tick/untick checkboxes, they record nothing.
- **Bottom action bar** (sticky): `N selected → [Mark Selected] [Mark
  Rejected] [Mark On hold]`. Buttons disabled at N = 0.
- **One confirmation dialog per action** — "Mark 12 students as Selected?
  Each will be notified immediately." No per-student dialogs anywhere.
- The per-student result `<select>` is **removed** — one flow only.
- Q10 unchanged: only `selected` advances; the Advance button behaviour
  (G6a) is untouched.
- Notification per student on record — unchanged semantics, now batched.

### B2 — Knock off / rename rounds (answer 2)

- Central CPC only (`@domain` gate + RLS unchanged — drive_rounds operator
  policies already exist; verify).
- A round with **any recorded fact** (participants scheduled, attendance,
  results) can be neither deleted nor renamed — the 0055 freeze principle,
  extended to name + existence. Refused in the domain AND by a trigger.
- Deleting a future round **renumbers** the remaining rounds to close the
  gap (the PIF form's rule, applied to live drives).
- Entry point: "Manage rounds…" on the drive's rounds screen. Add-round
  already exists and stays.

## Batch C — Central CPC screens

### C-picker — one shared drive picker (items 1, 2, 5, 7)

Shortlisting, Rounds & results, Attendance and Final selection all open with
the same picker (today: results has a bare list, the other three dead-end at
"Choose a drive…" with NO list — the "empty page" reports):

- Row: **company name** — role title · raised {date} · status badge.
- Search box (company or role). Default sort **oldest first**; toggle.
- Scope: drives relevant to the page (shortlisting: applications to rank;
  attendance/results/final: in-progress statuses).

### C3 — Mark drive completed (answer 3b)

- Domain rule `canCompleteDrive`: every application holds a terminal
  outcome (offer / rejected / not selected). Then the Central CPC may mark
  completed.
- **Force-complete allowed with a typed reason** (3b), audit-logged; the
  dialog lists how many students are still undecided.
- Button on the drive's rounds screen + cockpit card (in_rounds).
- Completed drives appear under Drives → Completed (existing route filters
  by status — verify end-to-end once statuses actually move).

### C6 — Absent alerts (answer 4)

- The moment attendance is recorded `absent`, the student gets an in-app
  notification naming the drive and round — 0043 trigger pattern.
  Email joins when the email provider lands (Phase 2 of §21.2).

### C8 — Clickable stage counts (answer 5b)

- On the Live/Completed cockpit cards, each count (Applied, Shortlisted,
  In rounds, Offers, Not selected) becomes a link to the drive's canonical
  page (`/drives/:id?stage=…`) filtered to that stage.
- The drive record page grows a stage-filtered applicant list; each name
  links to the canonical student page (`/students/:id`, built 20/08 Q7b).

---

## Build order

1. Domain: `round-editing` (knock-off/rename freeze), `drive-completion`
   (`canCompleteDrive` + force), stage filter helpers.
2. Features: shared picker; rounds bulk bar; manage-rounds dialog;
   completed action; cockpit count links; record-page stage list.
3. DB: migration 0057 — round delete/rename freeze trigger, absent-alert
   notification trigger; pgTAP/PGlite proofs.
4. Ship: check → db push → deploy → live verify → handover.
