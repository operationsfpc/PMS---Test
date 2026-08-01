# FACE Prep Campus — Placement Management System (PMS)

Project instructions. Read this file completely at the start of every session.

---

## 🔴 RULE 1 — TEST-DRIVEN DEVELOPMENT IS MANDATORY

**No production code is written before a failing test exists for it. No exceptions.**

Every change follows **RED → GREEN → REFACTOR**:

1. **RED** — Write the smallest failing test that expresses the next required behaviour. Run it. **Watch it fail.** A test that has never failed proves nothing.
2. **GREEN** — Write the minimum production code to make it pass. Nothing more. No speculative generality.
3. **REFACTOR** — Clean up with the tests green. Run the suite again.

Non-negotiables:

- Never write production code "and then add tests after".
- Never edit a test to fit broken production code. Fix the code, or explicitly agree the spec changed.
- Never disable, `.skip`, or comment out a failing test to make the suite pass. If a test must be quarantined, say so out loud and get agreement.
- Never claim work is done without running the suite and pasting the result.
- Bug fixes start with a **failing regression test** that reproduces the bug.

**Coverage gates (CI blocks below these):**

| Area | Threshold |
|---|---|
| `src/domain/**` (pure business rules) | **100%** lines + branches |
| `src/features/**`, `src/lib/**` | 80% lines |
| Generated files, `*.d.ts`, config | exempt |

**Test layers:**

| Layer | Tool | Scope |
|---|---|---|
| Domain rules | Vitest | Pure functions, no React, no I/O, no mocks needed |
| Components | Vitest + React Testing Library | Behaviour via accessible roles — never implementation details |
| Contract / API | MSW | The mock backend the UI is built against |
| RLS policies | pgTAP | Every role × every table. Untested RLS is a data breach |
| Journeys | Playwright | One end-to-end journey per role |

Query by role and accessible name (`getByRole`, `getByLabelText`). Do not assert on CSS classes or test IDs unless there is no accessible alternative.

---

## 🔴 RULE 2 — ASK ALL QUESTIONS BEFORE STARTING WORK, AT EVERY STAGE

**Before beginning any new stage of work, surface every question, ambiguity, assumption and conflict — and wait for answers.**

This applies at *every* stage, not just at project kickoff: before a new module, a new screen, a schema change, a refactor, a deployment.

- If the PRD and the PIF disagree, **stop and ask**. Do not silently pick one.
- If a requirement is ambiguous, **ask**. Do not guess and build.
- If an answer implies a change elsewhere in the system, **say so** before building.
- Prefer asking too many questions over building the wrong thing.
- State assumptions explicitly and get them confirmed. Never bury an assumption in code.
- When a stage completes, ask the questions for the next stage before starting it.

Open items live in `docs/domain-model.md` under **Open Questions** and must be marked `⚠️ ASSUMPTION — UNCONFIRMED` in code comments until answered.

---

## Product

Placement Management System for **FACE Prep Campus** (Focus 4D Career Education Pvt Ltd). Manages the full campus placement lifecycle across partner colleges: student registration → drive initiation → targeted announcement → applications → internal shortlisting → recruiter handoff → rounds → attendance → results → offers → compliance reporting. Everything audit-logged.

**Source of truth:** `docs/PRD-extracted.md` (v2.0) and `docs/PIF-extracted.md`. The `.docx` originals are alongside them.

**Scale:** 600 students / 10 campuses at launch → 2,000 students / 25 campuses at 24 months. **This is a correctness problem, not a scaling problem.** Optimise for business-rule accuracy and auditability, never for premature performance.

**MVP excludes:** WhatsApp alerts, native mobile app, recruiter portal, compliance reporting module (all Phase 2).

---

## Architecture — three layers, built in this order

```
Layer 0  src/domain/     Pure TypeScript business rules. Zero dependencies.
                         No React. No Supabase. No I/O. 100% test coverage.
                         This is the PRD expressed as executable, testable code.

Layer 1  src/features/   UI built against MSW mocks + Zod contracts.
                         Imports Layer 0 for all decisions. Never re-implements a rule.

Layer 2  supabase/       Schema built to match the contract Layer 1 proved.
                         RLS + triggers enforce Layer 0 rules server-side too.
```

**The golden rule: business rules live in `src/domain` and nowhere else.** If a component or an RPC decides whether a student may apply to a drive, that is a bug. It calls `src/domain`.

Boundaries are enforced by **`src/architecture.test.ts`** — an executable test, not a separate tool. (dependency-cruiser was dropped: it requires `typescript <7` and we run TS 7.)
- `src/domain` may import **nothing** — not React, not Supabase, not even Node built-ins.
- `src/features/<a>` may not import from `src/features/<b>`; share via `src/domain` or `src/components`.

The test has been verified to fail on violation, not just to pass.

---

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` |
| Build | Vite |
| Framework | React 19 + React Router v7 (SPA mode — every screen is behind login, no SSR) |
| Styling | Tailwind v4 + shadcn/ui (Radix) |
| Server state | TanStack Query |
| Tables | TanStack Table + TanStack Virtual |
| Forms | React Hook Form + Zod (Zod schemas are the single source of truth for shape) |
| Charts | Recharts |
| Unit / component | Vitest + React Testing Library |
| Mock backend | MSW |
| E2E | Playwright |
| RLS tests | pgTAP |
| Database | Supabase Postgres — region **ap-south-1 (Mumbai)** |
| Auth / Storage | Supabase Auth + Storage (signed, expiring URLs only) |
| Server logic | Supabase Edge Functions (Deno) |
| Queue | pgmq + pg_cron |
| Email | **Gmail/Workspace** per the client; integration details pending. Keep behind an `EmailProvider` interface. ⚠️ Gmail caps ~2,000/day with no delivery webhooks — PRD §21.2 needs bursts of 2,000+ with per-student delivery status, so a transactional provider will be needed before launch. |
| Schema testing | **PGlite** (PostgreSQL 18 in WASM) — no Docker on this machine |
| Type generation | `pnpm db:types` — introspects migrations via PGlite (`supabase gen types` needs Docker) |
| Hosting | Cloudflare Workers Static Assets |
| Package manager | pnpm |
| Lint / format | Biome |
| Hooks | lefthook (pre-commit: format + lint; pre-push: full test suite) |
| CI | GitHub Actions |
| Repo | **Local only for now.** No remote. Commit locally. |

---

## Design system

Brand tokens extracted from `faceprepcampus.com` (final host).

| Token | Value | Use |
|---|---|---|
| `--primary` | `#3D3777` | Deep indigo — nav, primary buttons, headers |
| `--secondary` | `#FFB800` | Amber — CTAs, highlights |
| `--accent` | `#A46AFC` | Violet — borders, focus rings |
| `--accent-2` | `#1EE0E1` | Cyan — gradient partner |
| `--warning` | `#FF7200` | Orange |
| `--destructive` | `#DD4820` on `#FFF0EC` | Errors, validation |
| Neutrals | `#ECF1F0` `#DADADA` `#F5F5F5` `#EEEEEE` | Surfaces |
| Heading font | **Raleway** | |
| Body font | **Geist** | |

**Light mode first** (data-dense internal tool). Dark mode later.

**Mobile-first is mandatory for every student-facing screen** — PRD §21.2: students are primarily on phones. Staff screens may assume desktop but must not break on tablet.

---

## Canonical role categories (FINAL — supersedes both source documents)

These five values are used for student preferences, resume uploads, and drive role classification. They must match exactly across SRF and PIF or preference matching breaks.

1. `software_technical` — Software / Technical
2. `technical_support_it_ops` — Technical Support / IT Operations
3. `digital_marketing` — Digital Marketing
4. `sales` — Sales
5. `operations_business` — Operations and Business Roles

---

## User roles

`admin` · `student` · `campus_placement_coordinator` (CPC) · `campus_manager` · `account_executive` (AE) · `delivery_head` · `central_placement_coordinator` (Central CPC — **single instance in MVP**) · `key_account_manager` (KAM) · `enterprise_relations` (ER) · `er_head` (read-only) · `ceo`

---

## Conventions

- **Money:** CTC always stored as **numeric LPA** (`ctc_min_lpa`, `ctc_max_lpa`), never parsed from free text. A separate free-text `ctc_breakup` holds the fixed/variable detail for display.
- **Dates:** store UTC `timestamptz`; display in **Asia/Kolkata**. Never use `Date` arithmetic in domain code — pass explicit `now: Date` into pure functions so tests control time.
- **Money/marks comparisons:** never use floating point equality. Use explicit tolerance helpers in `src/domain/math.ts`.
- **Enums:** TypeScript string-literal unions in `src/domain/types.ts`, mirrored by Postgres enums. Never magic strings in features.
- **Audit:** every mutating action writes an audit entry with actor, timestamp, before, after, reason. Enforced by Postgres triggers, not application code. The audit table is **append-only** (UPDATE/DELETE revoked).
- **Immutability:** applications snapshot the student profile + role-relevant resume at apply time. All downstream steps read the **snapshot**, never the live profile.
- **Naming:** files `kebab-case`, components `PascalCase`, domain functions `camelCase` and verb-led (`canApplyToDrive`, `classifyOfferCategory`).
- **Commits:** Conventional Commits. Each commit leaves the suite green.

---

## Commands

```bash
pnpm dev            # Vite dev server (MSW mock backend)
pnpm test           # Vitest watch  ← the TDD loop
pnpm test:run       # Single pass
pnpm test:cov       # Coverage, enforces gates
pnpm check          # Biome + tsc + full coverage suite
pnpm db:types       # Regenerate src/db/database.types.ts from migrations
pnpm supabase ...   # Supabase CLI (project-local dev dependency)
pnpm db:push        # supabase db push  — NOT YET RUN against Mumbai
```

**Read `docs/HANDOVER.md` first.** It holds current state, every confirmed
decision, and the exact next step.

---

## Working agreement

- **UI first.** Layer 0 → Layer 1 → Layer 2. The database is designed *after* the UI has proven the data contract.
- Do not scaffold a module until its domain rules exist and are green.
- Do not add a dependency without saying why and getting agreement.
- Keep responses concise. Show file paths clearly.
- When a stage finishes: run the suite, report the result, then **ask the next stage's questions**.
