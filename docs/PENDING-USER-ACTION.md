# Pending — needs you, not me

Work that cannot be completed without a decision, a credential, or a file that
only you can supply. Everything else proceeds on assumptions (`ASSUMPTIONS.md`).

| # | Blocks | What is needed | Why I cannot assume it |
|---|---|---|---|
| **P1** | Email notifications, pgmq queue, invitation emails | **Choose a transactional email provider** and supply an API key | PRD §21.2 needs bursts of 2,000+ with per-student delivery status. Gmail/Workspace caps at ~2,000/day with **no delivery webhooks**, so it cannot report delivery. Code is written behind an `EmailProvider` interface; only the adapter and key are missing |
| **P2** | ✅ **ANSWERED 2026-08-19** — "move to xlsx import" | Library choice delegated; **ExcelJS** (MIT-licensed, maintained on npm — SheetJS's npm build is stale). New scope arrived with the answer: **the recruiter export must carry each shortlisted student's resume as a PDF** — clarifying questions with Karthik | — |
| **P3** | R11 shortlist ranking quality | **A35 + A36 ANSWERED 2026-08-19**: "1-5 SCALE; Students do not see their scores" — shipped as `0052` (whole numbers 1–5; student read was already nothing). Still open: **the R11 ranking weights** (CGPA 40 · skills 30 · arrears 15 · role preference 15 remain assumptions) | Weights unconfirmed; ranking is consistent but unconfirmed |
| **P4** | Compliance module (Phase 2) | NIRF / NAAC / NBA / AICTE report formats | Never supplied. Out of MVP scope anyway |
| **P5** | Roster template fidelity | One **real college roster file** | A5 made our template canonical. If a real file differs, the importer changes |
| **P6** | Staff onboarding | **A campus placement coordinator.** There are currently **0** | 6 staff exist (3 admins, 2 Central CPCs, 1 AE). The campus CPC role has no holder since `sainaveen` was removed, so nobody is campus-scoped. Nothing is broken — a Central CPC is org-wide and runs both queues — but the first campus CPC appointed **must be mapped to a campus** (or every queue they open is silently empty) and **must not also be on the student roster** (0040 now refuses that outright) |
| **P7** | Go-live | Google OAuth consent screen verification, if you expect >100 users | Unverified apps hit a user cap |
| **P9** | ✅ **RESOLVED 2026-08-19** — Karthik: "update" | Both rows restored live: Wipro and Accenture (live) carry `min_overall_cgpa = 7.50` again. Only cgpa-scale rows with the fingerprint were touched — exactly 2. Same transaction also canonicalised every drive's `shift_type` (Karthik: "you decide and move"): `Night→night`, `Day→day`, and `9 AM to 7 PM→day` (a day shift written as hours; the original wording survives in the audit log) | — |

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

- **0041 backfilled one live offer's category.** Thanush Krishna's self-placed
  offer (FACE Prep Campus, ₹3.50 LPA) predated D6 and carried no category; the
  new constraint requires one. It was set to **regular** from the default
  bands (≤ ₹5 LPA). D6 says the approving coordinator chooses — if regular is
  wrong, it is one UPDATE to change. Under D5 this offer now blocks him from
  further regular-category drives.

- **Coverage gate.** `pnpm check` is red and **was red before this session's work** (proved against a clean `HEAD`): `src/domain` sits at 97.51% against the 100% rule, global branches 76.85% against 80%. Being brought back up.
- **Playwright E2E.** Configured in plan, no specs written. One journey per role is the stated target.

---

## P9 — the publish screen overwrote four live drives' declared CGPA cutoff

Found 2026-08-13 while fixing the "0 targeted students" report. **Fixed in code
and shipped; the four rows it already changed are a data decision.**

The publish screen fetched the cutoff the AE declared and then ignored it,
opening on a hardcoded 7.0 — and publishing wrote that invented figure back
over `drives.min_overall_cgpa`. Because every real student was being judged at
a CGPA of zero (the defect being fixed), the only way anyone could publish at
all was to clear that box, which stored **null**: no cutoff.

The fingerprint is still in the data — a declared figure with nothing beside it:

```sql
select company_name, status, min_overall_marks, min_overall_cgpa_scale, min_overall_cgpa
  from drives
 where min_overall_marks is not null
   and min_overall_cgpa is null;
```

Read live 2026-08-13, not remembered:

| Drive | Status | Declared | Stored cutoff | Applications |
|---|---|---|---|---|
| Wipro | live | 7.50 | **null** | 0 |
| Accenture | live | 7.50 | **null** | 1 |
| TCS · Cognizant | live | none | null | 3 · 2 |
| Wipro · Accenture (drafts) | draft | 7.50 | 7.50 — intact | 0 |
| HCL Technologies | approved | 75.00 % | 7.89 — intact | 0 |

TCS and Cognizant declared no cutoff on either column, so nothing was lost
there — they predate F12. The drafts and HCL are untouched because nobody has
published them yet, which is the whole point.

**The decision is yours because it is not reversible in spirit.** Options:

1. Leave both open — their application windows closed on 2026-08-12 anyway.
2. Restore 7.50 (`update drives set min_overall_cgpa = min_overall_marks where
   min_overall_marks is not null and min_overall_cgpa is null`). Accenture has
   one application already in flight; restoring a cutoff does not withdraw it
   (there is no withdrawal, PRD §7.4) but it does change who may still apply.

No new drive can lose its cutoff this way again: the screen now opens on the
cutoff the drive was approved with, and leaves the box **empty** when the drive
declares none rather than inventing one.

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
