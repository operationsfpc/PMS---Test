# Contributing to FPC-PMS

Welcome. This repo is **private** and holds the Placement Management System for
FACE Prep Campus. Read `CLAUDE.md` in full before your first commit — it is the
project constitution, not a style guide.

---

## 0. Before you touch anything

| Read | Why |
|---|---|
| `CLAUDE.md` | Standing rules, architecture layers, TDD rule, conventions |
| `docs/HANDOVER.md` | Current state and the exact next step |
| `docs/PRD-extracted.md` | Product source of truth |
| `docs/ASSUMPTIONS.md` | Decisions taken without confirmation — do not silently change these |

---

## 1. Setup

```bash
git clone https://github.com/karthikraja-ship-it/fpc-pms.git
cd fpc-pms

# Node >= 22 (we develop on 26), pnpm 11
pnpm install
pnpm lefthook install     # REQUIRED — installs the pre-commit / pre-push gates

cp .env.example .env      # ask Karthik for values; never commit .env
pnpm dev                  # runs against the MSW mock backend, no DB needed
```

`pnpm lefthook install` is not automatic. If you skip it you will push red code.

---

## 2. The one rule that gets PRs rejected

**No production code before a failing test exists for it.** RED → GREEN → REFACTOR.

- Bug fix? Start with a failing regression test that reproduces the bug.
- Never edit a test to fit broken code.
- Never `.skip` or comment out a failing test to go green. If a test genuinely
  needs quarantining, say so in the PR description and get agreement first.

Coverage gates (CI fails below these):

| Area | Threshold |
|---|---|
| `src/domain/**` | **100%** lines + branches |
| `src/features/**`, `src/lib/**` | 80% lines |

---

## 3. Architecture boundaries

```
Layer 0  src/domain/     Pure TS business rules. No React, no Supabase, no I/O.
Layer 1  src/features/   UI against MSW + Zod contracts. Calls Layer 0 for decisions.
Layer 2  supabase/       Schema + RLS enforcing Layer 0 server-side.
```

**Business rules live in `src/domain` and nowhere else.** If a component or an
RPC decides whether a student may apply to a drive, that is a bug — call the
domain function.

- `src/domain` imports **nothing**.
- `src/features/<a>` may not import `src/features/<b>` — share via `src/domain`
  or `src/components`.

Enforced by `src/architecture.test.ts`. Do not weaken that test to land a change.

---

## 4. Branching and PRs

Direct pushes to `main` are for the repo owner only. **Everyone else works on a
branch and opens a PR.**

```bash
git switch -c feat/drive-shortlisting
# ... TDD loop ...
pnpm check                 # lint + typecheck + coverage — must be green
git push -u origin feat/drive-shortlisting
gh pr create --fill
```

Branch names: `feat/…`, `fix/…`, `test/…`, `docs/…`, `chore/…`, `refactor/…`

Commits: **Conventional Commits**, and *every commit leaves the suite green*.

```
feat(drives): shortlist students by role preference
fix(approvals): one CTC-less PIF must not take the whole queue
test(domain): offer categorisation boundary cases
```

### PR checklist

- [ ] A test failed first, then passed
- [ ] `pnpm check` green locally
- [ ] No business rule added outside `src/domain`
- [ ] No new dependency without prior agreement (say why in the PR)
- [ ] No secrets, keys, or real student data in code, tests, fixtures or screenshots
- [ ] Any unconfirmed decision marked `⚠️ ASSUMPTION — UNCONFIRMED` at the call
      site **and** listed in `docs/domain-model.md` §10a
- [ ] Mobile-first verified if the screen is student-facing (PRD §21.2)

Keep PRs small and single-purpose. A 40-file PR will not get a useful discussion.

---

## 5. Conventions you will trip over

- **Money:** CTC as numeric LPA (`ctc_min_lpa` / `ctc_max_lpa`). Never parse from
  free text. Free-text detail goes in `ctc_breakup` for display only.
- **Dates:** store UTC `timestamptz`, display Asia/Kolkata. Never do `Date`
  arithmetic inside domain code — pass `now: Date` in so tests control time.
- **Floats:** never compare money or marks with `===`. Use `src/domain/math.ts`.
- **Enums:** string-literal unions in `src/domain/types.ts`, mirrored by Postgres
  enums. No magic strings in features.
- **Immutability:** applications snapshot the profile + resume at apply time.
  Downstream steps read the **snapshot**, never the live profile.
- **Audit:** every mutating action is audit-logged by Postgres triggers, not
  application code. The audit table is append-only.
- **Naming:** files `kebab-case`, components `PascalCase`, domain functions
  `camelCase` and verb-led (`canApplyToDrive`, `classifyOfferCategory`).
- **Queries in tests:** `getByRole` / `getByLabelText`. Do not assert on CSS
  classes or test IDs unless there is genuinely no accessible alternative.

---

## 6. Security — non-negotiable

This system holds **student personal data** for 600+ students across partner
colleges, rising to 2,000.

- Never commit `.env`, service-role keys, Supabase keys or Cloudflare tokens.
  Secrets go in git-ignored `.env`; Karthik provides them directly.
- Never paste a key into an issue, PR, commit message or chat.
- Never use real student data in tests, fixtures or screenshots — synthesise it.
- Storage is signed, expiring URLs only. Never make a bucket public.
- Touching RLS? Add or update the pgTAP tests. **Untested RLS is a data breach.**
- Found something sensitive already committed? Do not push a "fix" commit —
  tell Karthik so the credential is rotated and history handled properly.

---

## 7. Shipping

Shipping is **three separate acts**. None triggers the others, and none is
automatic:

```bash
git push origin main   # code to GitHub
pnpm db:push           # Supabase migrations  (live — check with Karthik first)
pnpm deploy            # Cloudflare Workers
```

Collaborators: **do not run `pnpm db:push` or `pnpm deploy`.** Those hit live
infrastructure. Open the PR and let Karthik ship.

---

## 8. Getting help

Ask early rather than guessing at a business rule — the PRD has gaps and a wrong
assumption baked into `src/domain` is expensive to unpick. Raise it as a numbered
list so it is easy to answer point-by-point.
