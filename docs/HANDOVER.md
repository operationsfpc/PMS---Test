# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
Last updated at commit `bb6f06a`. **588 tests passing across 48 files** (verified, not remembered).

**Live:** <https://fpc-pms.faceprep.workers.dev> · database on Supabase ap-south-1 · Google sign-in **confirmed working end to end**.

---

## 0. The two standing rules (from CLAUDE.md — non-negotiable)

1. **TDD is mandatory.** Red → green → refactor. No production code before a failing test. Never edit a test to fit broken code. Never `.skip` to go green.
2. **Ask every question before starting any stage** — not just at kickoff. If the PRD and the PIF disagree, stop and ask. Never silently pick one.

---

## 1. Where the project stands

| Layer | State |
|---|---|
| **Layer 0 — domain rules** | ✅ Complete for MVP. R1–R10 + SRF validators. 100% coverage, enforced |
| **Layer 1 — UI** | 🟡 Real: login, SRF, CPC verification queue, AE PIF form, Delivery Head approvals, student drives list. Still mocks: student dashboard, shortlisting, DAF publish, attendance |
| **Layer 2 — database** | ✅ **Live on Supabase ap-south-1 (Mumbai).** All 10 migrations applied; local and remote history match |

```
CLAUDE.md                    project instructions (auto-loaded)
docs/
  HANDOVER.md                this file
  domain-model.md            SIGNED-OFF spec — the build contract
  PRD-extracted.md           greppable PRD v2.0
  PIF-extracted.md           greppable PIF sample
src/
  domain/                    pure rules, zero deps, 100% coverage
  features/                  srf · student · cpc · delivery-head · central-cpc
  components/                app-shell, form, ui primitives
  db/                        PGlite harness, schema + security tests, generated types
  mocks/                     MSW handlers = the API contract
supabase/
  migrations/                0001–0010
  local/00_supabase_shim.sql local-only; NEVER deployed
scripts/gen-types.mjs        type generation without Docker
```

---

## 2. Confirmed decisions — later answers override earlier ones

| # | Decision |
|---|---|
| Role categories | **5, FINAL**: `software_technical`, `technical_support_it_ops`, `digital_marketing`, `sales`, `operations_business` |
| Hierarchy | City → Campus (partner college) → Degree → Branch. **No department level** |
| PIF flow | AE raises → **Delivery Head** approves → Central CPC completes & publishes |
| `offer_category` | **Delivery Head only**, at approval. Immutable afterwards |
| `drive_type` | AE may set; **Central CPC may edit**. (Revised from an earlier answer) |
| On-hold | A flag, valid from initiation until go-live. Reversible. Cannot publish while held |
| Rejected PIF | **Permanent.** No edit, no resubmit. Fresh PIF required |
| Internship cap | 1 per tenure. Once consumed, blocks **both** `internship` and `internship_convertible` — **cap is checked before the ladder** |
| **R5a override** | Central CPC's prestige-drive escape hatch. Bypasses ladder + cap. **Never** bypasses SRF approval, opt-out, disbarment or eligibility. Mandatory audit reason |
| Placement record | Highest CTC; ties → earliest declared; Central CPC override wins |
| Arrears | `no_history` is **stricter** than `no_standing` (forbids cleared backlogs too) |
| CGPA cutoff | Tests against **overall** CGPA |
| 10th/12th | Stored as **percentage** |
| Round 1 participants | Chosen by the **recruiter** from the exported list. Non-shortlisted students can never accrue absences |
| Round advancement | Only `selected` advances. `waitlisted`/`on_hold` are not scheduled until promoted |
| Absences | 3 cumulative, entire tenure, no reset. Triggers **review**, never automatic disbarment |
| Field editing | **No unlock workflow.** Coordinators edit verified data instantly (audit-logged). Students may **never** edit verified academic data |
| Opt-out | Student-initiated, CPC-approved, **irreversible**. In-process drives continue |
| Self-placed | Separate statistic. Does **not** affect ladder or eligibility |
| Drive mode | "Physical drive outside campus" — **never** "off-campus" (that means self-placed) |
| Auth | Roster holds the student's **Gmail**. Invite sent there. Login restricted to that exact address. Staff are Admin-invited |
| Founding admin | `karthikraja@faceprep.in` |
| Design | **Light mode, indigo-forward.** `#3D3777` primary, `#FFB800` secondary. Raleway + Geist |
| Logo gradient | `#C702D2 → #F3A863` is a **brand accent only** (header hairline), not routine UI |
| Files | 5 MB cap per document |
| Compliance module | **Phase 2**, not MVP |
| Hosting | Supabase **ap-south-1 (Mumbai)** + Cloudflare Workers. Git **local only**, no remote |

---

## 3. 🔴 The immediate next step

**The database is live.** Setup walkthrough: `docs/SUPABASE-SETUP.md`.

| | |
|---|---|
| Project | **FPC-PMS**, ref `poscikalmgfpvbjfytgw` |
| Region | South Asia (Mumbai) `ap-south-1` |
| Postgres | 17.6.1.155 |
| Migrations | `0001`–`0010` all applied; `migration list` shows local == remote |
| Storage | `marksheets`, `resumes`, `offer-letters` — all **private** |
| Types | `pnpm db:types` output byte-identical after formatting ⇒ **no schema drift** |
| `.env.local` | ✅ written (URL + anon key). Git-ignored |
| Founding admin | `karthikraja@faceprep.in` seeded in `staff_invitations` by `0002` — **confirmed a Google account** |

**Next coding task: the login screen + auth guard.** It does not exist — there
is no `signInWithOAuth` call anywhere in `src/`. Until it is built the app
still runs on MSW mocks and nobody can sign in.

Still outstanding from the user (dashboard work, never in chat):
- Google OAuth client ID + secret → **Supabase Dashboard → Auth → Providers → Google**
- Redirect URI in Google Cloud Console: `https://poscikalmgfpvbjfytgw.supabase.co/auth/v1/callback`

**Agreed plan:** login + auth guard, then drive the SRF end-to-end against Mumbai — one vertical slice working beats more mocks.

---

## 4. Things that will bite you if you don't know them

- **No Docker on this machine.** Schema is tested with **PGlite** (PostgreSQL 18 in WASM) via `src/db/harness.ts`. `supabase gen types` and `supabase start` will not work; use `pnpm db:types`.
- **`supabase/local/00_supabase_shim.sql` is test-only.** It fakes `auth.users`, `auth.uid()` and the Supabase roles. Never deploy it.
- **PGlite ≠ Supabase.** No GoTrue, Storage or pgmq. `0010_storage.sql` is guarded with `if to_regclass('storage.buckets') is null then return`. The first real push may still surface Supabase-specific issues.
- **Zod object-level `.refine()` only runs once every field parses.** So the arrear cross-field error only appears when the rest of the form is valid. Documented in `srf-form.test.ts`.
- **Two real defects were caught by the DB tests** — keep those tests:
  1. Bootstrap deadlock: `profiles.id → auth.users` while the allowlist required a profile first, so no staff could ever sign in. Fixed with `staff_invitations`.
  2. `protect_verified_academics` **failed open** — students have no `profiles` row, so the role lookup returned NULL and every student passed. Now identifies the actor positively.
- **`src/domain` must import nothing.** Enforced by `src/architecture.test.ts`.
- **Postgres enums and `src/domain/types.ts` must stay identical.** Enforced by `src/db/types-drift.test.ts`.

---

## 5. Open questions — ask before building the relevant piece

| Blocks | Question |
|---|---|
| R11 ranking / shortlisting | **Skill-repository score schema** still not supplied. What metrics, what scale? `skill_scores` table is deliberately generic |
| Email notifications | Gmail integration details pending. See the §21.2 volume warning in CLAUDE.md |
| Compliance module (Phase 2) | NIRF/NAAC/NBA/AICTE report formats never supplied |
| Roster import | Template is at `public/templates/student-roster-template.xlsx` — built from **my guess**. No real college file has been seen |
| PIF form build | `docs/PIF-extracted.md` Q13 hardcodes 6 degrees; I made degrees an Admin-managed table instead. Confirm before building the AE form |

---

## 5a. What was built in the 2026-08-02 session

All test-first, every cycle watched failing. 344 → 588 tests.

| Area | Modules |
|---|---|
| **Auth** | `login-page` · `require-auth` · `resolve-auth` · `auth-provider` · `role-landing` · domain `auth-routing` |
| **Domain rules added** | `srf-decision` · `drive-lifecycle` · `application-snapshot` (R7) · `rounds` · `roster-import` · `recruiter-export` · `APP_ROLES` |
| **Repositories (live DB)** | SRF submit · CPC verification · PIF · approval · publish · apply · rounds · offers · roster |
| **Screens wired** | CPC verification queue · AE PIF form · Delivery Head approvals · student drives list |
| **Infra** | Cloudflare Workers deploy (`pnpm deploy`) · `.assetsignore` · migration `0011` (PIF Q13 degrees) |

**Things worth knowing:**
- **R7 `buildApplicationSnapshot` did not exist** despite being specified. It is the immutability rule everything downstream reads.
- The **"Preview as" switcher was shipping to production** and drove navigation instead of the signed-in role. Now dev-only, pinned by a test that stubs `DEV: false`.
- `.DS_Store` and `mockServiceWorker.js` were publicly served on the first deploy. Now excluded, pinned by tests.
- `pnpm test:run` is **not sufficient** before committing. `pnpm check` caught four defects Vitest could not see (Vitest does not typecheck).

---

## 6. Not built yet

**Rules and repositories exist; the SCREEN does not:**
- Roster import UI (parser + repository are done and tested)
- Attendance / results screens against `rounds-repository` (still mocks)
- Offer declaration screen (repository done)
- Recruiter export UI + XLSX/ZIP generation (`buildRecruiterExport` is done)
- Central CPC publish screen against `publish-repository` (still a mock)

**Not started at all:**
- Executive / CEO / KAM / admin dashboards
- Notifications UI and the pgmq queue (no email provider chosen)
- Opt-out and self-placed flows
- Result corrections
- R11 `rankApplicants` — still blocked on the skill-score schema
- Playwright E2E (configured in plan, no specs written)

`/central/drives` → cockpit and `/central/publish` → DAF targeting both work. Use the **"Preview as" role switcher** in the header to browse the mocks without auth.

---

## 7. First commands in a new session

```bash
cd ~/fpc-pms
export PATH="$HOME/.npm-global/bin:$PATH"   # pnpm lives here
pnpm install
pnpm test:run          # expect 344 passing
pnpm dev               # localhost:5173, MSW-backed
```

Git is **local only**, no remote. Ten commits, working tree **clean** — the Supabase CLI dev-dependency (`^2.111.0`) is committed.

`.env.local` **does not exist yet** — copy it from `.env.example` once the Supabase project is created.
