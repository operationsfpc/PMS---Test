# Pending — needs you, not me

Work that cannot be completed without a decision, a credential, or a file that
only you can supply. Everything else proceeds on assumptions (`ASSUMPTIONS.md`).

| # | Blocks | What is needed | Why I cannot assume it |
|---|---|---|---|
| **P1** | Email notifications, pgmq queue, invitation emails | **Choose a transactional email provider** and supply an API key | PRD §21.2 needs bursts of 2,000+ with per-student delivery status. Gmail/Workspace caps at ~2,000/day with **no delivery webhooks**, so it cannot report delivery. Code is written behind an `EmailProvider` interface; only the adapter and key are missing |
| **P2** | `.xlsx` roster import, recruiter export pack | **Approve a spreadsheet library** (SheetJS `xlsx`, or ExcelJS) | A new runtime dependency. CSV works today; `parseCsv` is ours |
| **P3** | R11 shortlist ranking quality | **Partially answered 2026-08-06**: the skill AREAS and who writes them (Central CPC) are confirmed; the repository is built (`/central/skills`, migration 0037). Still needed: **confirm the 0–100 scale (A35)**, whether students may see their own scores (A36), and the R11 ranking weights | Scale and weights remain assumptions; ranking is consistent but unconfirmed |
| **P4** | Compliance module (Phase 2) | NIRF / NAAC / NBA / AICTE report formats | Never supplied. Out of MVP scope anyway |
| **P5** | Roster template fidelity | One **real college roster file** | A5 made our template canonical. If a real file differs, the importer changes |
| **P6** | Staff onboarding | Real staff names, emails and roles to invite | Only `karthikraja@faceprep.in` exists. The Invite staff screen is built; the list of people is yours |
| **P7** | Go-live | Google OAuth consent screen verification, if you expect >100 users | Unverified apps hit a user cap |

## Answered

**P8 — ✅ RESOLVED 2026-08-06 by the client.** `sainaveen@faceprep.in` was
removed from staff, keeping only their student row. Verified live: no profile
(active or inactive), **no orphaned invitation** — so no ghost of the kind
`thanush@faceprep.in` left behind — and
**`students_who_are_also_staff` is now 0**. Re-proved end to end on that very
account, in a rolled-back transaction: form `srf_approved` → its certificate
`verified`, stamped with the approving coordinator.

⚠️ Consequence, not a fault: there are now **0 active campus placement
coordinators** and 2 Central CPCs. Everything still works — a Central CPC is
org-wide, so they run both the verification and certificate queues. The campus
CPC path is proven too (a campus CPC verifying a certificate was proved live
before the removal); it simply has no holder today. **The first real campus
CPC appointed must be mapped to a campus, and must NOT also be on the student
roster.**

| # | Question | Answer | Where it landed |
|---|---|---|---|
| **KAM scope** | Is a Key Account Manager campus-scoped or organisation-wide? | **Campus-scoped.** "A key account manager takes care of a few campuses. Campuses have to be mapped to a key account manager." (2026-08-05) | Migration `0018`: `is_campus_reader()` now includes `key_account_manager`, scoped by `staff_campus_assignments` — the mapping the Admin already makes at invitation time. Read-only: a KAM does not verify marksheets or mark attendance |

## Not blocking, but worth your attention

- **Coverage gate.** `pnpm check` is red and **was red before this session's work** (proved against a clean `HEAD`): `src/domain` sits at 97.51% against the 100% rule, global branches 76.85% against 80%. Being brought back up.
- **Playwright E2E.** Configured in plan, no specs written. One journey per role is the stated target.

---

## UAT 2026-08-06 (F9) — delete the test certificates already in the database

**Requested:** "Also, please delete the previously uploaded test certificates
from the database."

**Not doable from here.** This is a production data operation against the
Mumbai project, and there is no way to tell a real certificate from a test one
from the schema alone — only whoever uploaded them knows.

Two things to do, in this order:

1. **The old free-text column.** `students.certifications` is superseded by
   `student_certificates` (0034) and is no longer written by `submit_srf`
   (0035). It is deliberately NOT dropped: dropping a column that holds real
   data is a separate decision and is not reversible. Read it, decide what is
   worth keeping, then drop it in its own migration.

2. **The test uploads.** Certificates now live in two places — a row in
   `student_certificates` and an object in the `marksheets` bucket. Deleting
   the row cascades nothing in storage, so both have to go:

```sql
-- Inspect first. Never run the delete blind.
select c.id, s.full_name, s.roll_number, c.name, d.storage_path, c.created_at
  from student_certificates c
  join students s on s.id = c.student_id
  join student_documents d on d.id = c.document_id
 order by c.created_at;
```

Then delete the chosen rows and remove the matching objects from the
`marksheets` bucket. `student_certificates.document_id` cascades from
`student_documents`, so deleting the document row removes the certificate row
with it.
