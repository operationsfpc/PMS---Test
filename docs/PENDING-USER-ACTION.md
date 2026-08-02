# Pending — needs you, not me

Work that cannot be completed without a decision, a credential, or a file that
only you can supply. Everything else proceeds on assumptions (`ASSUMPTIONS.md`).

| # | Blocks | What is needed | Why I cannot assume it |
|---|---|---|---|
| **P1** | Email notifications, pgmq queue, invitation emails | **Choose a transactional email provider** and supply an API key | PRD §21.2 needs bursts of 2,000+ with per-student delivery status. Gmail/Workspace caps at ~2,000/day with **no delivery webhooks**, so it cannot report delivery. Code is written behind an `EmailProvider` interface; only the adapter and key are missing |
| **P2** | `.xlsx` roster import, recruiter export pack | **Approve a spreadsheet library** (SheetJS `xlsx`, or ExcelJS) | A new runtime dependency. CSV works today; `parseCsv` is ours |
| **P3** | R11 shortlist ranking quality | **The skill-repository score schema** — which metrics, what scale, who writes them | Invented under A12. Ranking will be wrong-but-consistent until replaced |
| **P4** | Compliance module (Phase 2) | NIRF / NAAC / NBA / AICTE report formats | Never supplied. Out of MVP scope anyway |
| **P5** | Roster template fidelity | One **real college roster file** | A5 made our template canonical. If a real file differs, the importer changes |
| **P6** | Staff onboarding | Real staff names, emails and roles to invite | Only `karthikraja@faceprep.in` exists. The Invite staff screen is built; the list of people is yours |
| **P7** | Go-live | Google OAuth consent screen verification, if you expect >100 users | Unverified apps hit a user cap |

## Not blocking, but worth your attention

- **Coverage gate.** `pnpm check` is red and **was red before this session's work** (proved against a clean `HEAD`): `src/domain` sits at 97.51% against the 100% rule, global branches 76.85% against 80%. Being brought back up.
- **Playwright E2E.** Configured in plan, no specs written. One journey per role is the stated target.
