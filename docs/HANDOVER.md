# Session Handover — FACE Prep Campus PMS

**Read this, then `CLAUDE.md`, then `docs/domain-model.md`.**
Last updated at commit `afdeac4`. **614 tests passing across 51 files** (verified, not remembered).

**Live:** <https://fpc-pms.faceprep.workers.dev> · database on Supabase ap-south-1 · Google sign-in **confirmed working end to end by the user**.

---

## 0. The standing rule (from CLAUDE.md — non-negotiable)

**TDD is mandatory.** Red → green → refactor. No production code before a failing test. Never edit a test to fit broken code. Never `.skip` to go green.

The former "ask every question first" rule was **removed on 2026-08-02** at the
user's request. Make reasonable assumptions and keep moving; mark them
`⚠️ ASSUMPTION — UNCONFIRMED` at the call site and list them in
`docs/domain-model.md` §10a.

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
| CGPA cutoff | ~~Tests against overall CGPA~~ **SUPERSEDED 2026-08-04:** tests against the **latest VERIFIED semester** CGPA. Unverified lines never decide eligibility — a student types their own marks. Falls back to the roster figure while no semester is verified |
| Academics | **Semester-wise.** Student declares UG or PG. UG: one line per semester, max **10**. PG: one aggregate line for the completed UG, then max **4** PG lines. Each line = CGPA (not GPA) + standing arrears + history of arrears |
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

**Next task: the round results screen, then offer declaration.** Both have
tested repositories already (`rounds-repository.recordResult`,
`offers-repository.declareOffer`) and no UI. Follow the shape of
`cpc/attendance-page.tsx` — component takes an injected view, route wrapper
builds the Supabase one.

**Two decisions the user still owes:**
1. **Email provider** — explicitly deferred on 2026-08-02. Notifications and
   pgmq cannot be built until it is chosen. Gmail's ~2,000/day cap with no
   delivery webhooks does not meet PRD §21.2.
2. **A spreadsheet library** (SheetJS or similar) — needed for `.xlsx` roster
   import and the recruiter export pack. Roster import currently accepts
   **CSV only**. Do not add it without asking.

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
- **One feature must never import another.** The same test enforces it, and it
  fired for real this session. Auth state therefore lives in
  `src/lib/auth-context.tsx`, not in `features/auth` — `features/auth` merely
  re-exports it.
- **`pnpm test:run` is NOT enough before committing.** Vitest does not
  typecheck. `pnpm check` caught five defects it could not see, including
  PostgREST returning embedded to-one relations as an object while the
  generated types declare an array (see `one<T>()` in `student/drives-view.ts`).
- **Prefer the `edit` tool over scripted find-and-replace.** A `python`
  replacement silently no-oped this session because Biome had reformatted the
  target, and the failure surfaced later as a confusing test error.
- **Mocks vs real:** `/student` is still a VISUAL MOCK with fabricated data
  (Priya, Freshworks). The real student screen is `/student/drives`. Do not
  demo `/student`.
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

## 5a. What was built in the 2026-08-02 session (27 commits, 344 → 614 tests)

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
- Round results / progression screen (`rounds-repository.recordResult`, `nextRoundParticipants`)
- Offer declaration screen (`offers-repository.declareOffer`)
- Recruiter export UI + XLSX/ZIP generation (`buildRecruiterExport` is done) — **needs a dependency decision**
- Central CPC publish screen against `publish-repository` (still a mock)
- `.xlsx` roster import (CSV works today; `parseCsv` is ours, in `src/domain/csv.ts`)

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
