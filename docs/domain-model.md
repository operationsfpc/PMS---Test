# Domain Model — FACE Prep PMS

**Status:** ✅ SIGNED OFF. Q1–Q5 resolved in session. This is the build specification.
**Sources:** `PRD-extracted.md` (v2.0) · `PIF-extracted.md` · decisions confirmed in session.

This document is the specification that `src/domain/` will implement, test-first. Every rule below becomes a named, executable test.

---

## 1. Reference data

### 1.1 Role categories (FINAL — 5)

| Code | Label |
|---|---|
| `software_technical` | Software / Technical |
| `technical_support_it_ops` | Technical Support / IT Operations |
| `digital_marketing` | Digital Marketing |
| `sales` | Sales |
| `operations_business` | Operations and Business Roles |

Used identically for: student preferences, one resume per selected category, and drive role classification.

### 1.2 Offer categories (Admin-configurable bands)

| Code | Rank | Default band |
|---|---|---|
| `regular` | 1 | ≤ ₹5 LPA |
| `dream` | 2 | > ₹5 and ≤ ₹10 LPA |
| `super_dream` | 3 | > ₹10 LPA |

Bands are **reference guidance only**. The system *suggests*; the Central CPC *decides* and the decision is stored on the drive (PRD §10).

### 1.3 Drive types

| Code | On category ladder? | Consumes internship cap? |
|---|---|---|
| `placement` | Yes | No |
| `internship_convertible` | Yes | **Yes** |
| `internship` | No (parallel track) | Yes |

### 1.4 Hierarchy

`City → Campus (partner college) → Degree → Branch`
One campus has many degrees; one degree has many branches. **No "department" level.**

---

## 2. Student

### 2.1 Lifecycle — two orthogonal axes

Modelled as two independent fields, not one enum, because they combine freely.

**`srf_status`**
```
invited ──claim──▶ registered ──submit──▶ srf_submitted ──CPC approve──▶ srf_approved
                        ▲                       │
                        └────CPC reject─────────┘  (reason required, may resubmit)
```

- `invited` — roster pre-loaded by campus. Not yet claimed.
- `srf_approved` is the **only** state in which a student may receive DAFs or apply. (PRD §22.1)

**`participation_status`**
```
active ──student opt-out request + CPC approve──▶ opted_out   (TERMINAL, IRREVERSIBLE)
   │
   └──Central CPC manual decision──▶ disbarred
```

Both `opted_out` and `disbarred` block **new** drives. Both allow **in-process** drives to continue to completion. (Confirmed in session.)

### 2.2 Roster pre-load fields

`roll_number` (unique per campus) · `name` · `email` · `degree` · `branch` · `passing_year`

Students claim their record; they cannot self-register an arbitrary account.

### 2.3 Profile data

- **Academic:** 10th %, 12th %, degree, branch, semester-wise CGPA, overall CGPA, current arrears, history of arrears
- **Marksheets:** 10th, 12th, every available UG/PG semester (backfilled at SRF time)
- **Contact:** email, mobile, WhatsApp, alternate
- **Preferences:** any subset of the 5 role categories
- **Resumes:** one PDF per selected role category
- **Profiles:** LinkedIn, GitHub, LeetCode, HackerRank
- **Detail:** projects, certifications, areas of interest, areas of expertise, technical skills, achievements
- **Consent:** captured at SRF submission

---

## 3. Drive (PIF → DAF) — one aggregate, many hands

The PIF and the drive are **one record** moving through three owners. Sections 1–4 of the PIF form are AE-owned; Section 5 is Delivery-owned.

### 3.1 Status machine

```
   AE                    Delivery Head              Central CPC
   ──                    ─────────────              ───────────
 draft ──submit──▶ submitted ──approve──▶ approved ──complete+classify+publish──▶ live
                       │        (sets drive_type)                                   │
                       │                                                   window closes
                       ├──reject──▶ rejected  ◀── TERMINAL. Permanent.               ▼
                       │            Reason mandatory. No edit,              applications_closed
                       │            no resubmit. Fresh PIF required.                 │
                       │                                                             ▼
                       └──────────────────────────────────────────────────▶     in_rounds
                                                                                     │
                                                                                     ▼
                                                                                 completed
```

### 3.2 On-hold

Modelled as a **flag**, not a status, so it composes with `draft | submitted | approved` without state explosion.

| Field | Rule |
|---|---|
| `on_hold: boolean` | May only be set while status ∈ `{draft, submitted, approved}` — i.e. from initiation until the Central CPC makes it live |
| `on_hold_reason` | Required when setting |
| **Invariant** | A drive **cannot** transition to `live` while `on_hold = true` |
| Reversible | Yes — unlike `rejected`, which is terminal |

### 3.3 Who sets what

| Field | Owner | Stage |
|---|---|---|
| PIF Sections 1–4 (company, role, eligibility, process) | **AE** | `draft` |
| `drive_type` (placement / internship / internship-convertible) | **Delivery Head** | at approval — **FINAL, Central CPC cannot change** |
| `offer_category` (Regular / Dream / Super Dream) | **Delivery Head** | at approval — **FINAL, Central CPC cannot change** |
| Approve / reject (+ reason) | **Delivery Head** | `submitted → approved \| rejected` |
| Completion of remaining vacant fields | **Central CPC** | `approved` |
| Structured rounds, audience targeting, application window | **Central CPC** | at publish |

### 3.4 CTC

PIF Q10 is free text; the domain needs numbers.

| Field | Type | Purpose |
|---|---|---|
| `ctc_min_lpa` | `numeric` required | Range floor |
| `ctc_max_lpa` | `numeric` nullable | Range ceiling; null ⇒ fixed CTC |
| `ctc_breakup` | `text` | Free-text fixed/variable detail, display only |
| `offer_category` | enum | **Delivery Head's** decision at approval; system *suggests* from `ctc_max_lpa ?? ctc_min_lpa`. Immutable thereafter. |

Per-student actual offer CTC is captured separately at offer upload as `offer.ctc_lpa` — that is what drives the placement record.

### 3.5 Mandatory before `live` (PRD §6.2)

company · role title · role category · JD · location(s) · `ctc_min_lpa` · `drive_type` · `offer_category` · eligibility · ≥1 structured round · timeline · application start + end · `on_hold = false`

### 3.6 Edits after go-live

Do **not** re-run eligibility for existing applicants. Notification on change is at the Central CPC's discretion, per change. Always audit-logged.

---

## 4. The core rules — `src/domain/`

Each is a **pure function**. No I/O, no clock, no randomness — `now: Date` is always passed in.

### R1 · `classifyOfferCategory(ctcLpa, bands) → OfferCategory`
Suggestion only. Boundary cases are exact: ₹5.00 ⇒ `regular`, ₹5.01 ⇒ `dream`, ₹10.00 ⇒ `dream`, ₹10.01 ⇒ `super_dream`.

### R2 · `evaluateEligibility(snapshot, drive) → { eligible, failures[] }`
Checks degree, branch, passing year, CGPA cutoff, 10th/12th cutoffs, arrear policy (`no_standing` / `no_history` / `flexible`), city, campus.
**Evaluated at the instant of application, against verified data only.** Returns *every* failure reason, not just the first — the UI must explain fully.

### R3 · `highestOfferCategory(offers) → OfferCategory | null`
Max rank across `final_selected` offers from `placement` and `internship_convertible` drives. Plain internships never count.

### R4 · `isInternshipCapConsumed(offers) → boolean`
True if any `final_selected` offer came from an `internship` **or** `internship_convertible` drive. Cap = 1.

### R5 · `isDriveVisibleToStudent(student, drive, offers) → boolean`
The category-ladder rule. Governs **new** drives only.

| Condition | Result |
|---|---|
| `srf_status ≠ srf_approved` | hidden |
| `participation_status ∈ {opted_out, disbarred}` | hidden |
| not in targeted audience, or `evaluateEligibility` fails | hidden |
| `drive_type ∈ {internship, internship_convertible}` **and** cap consumed | hidden — **cap is checked before the ladder** |
| `drive_type ∈ {placement, internship_convertible}` and student not placed | **visible** |
| `drive_type ∈ {placement, internship_convertible}` and `rank(drive) > rank(highest)` | **visible** |
| `drive_type ∈ {placement, internship_convertible}` and `rank(drive) ≤ rank(highest)` | hidden |
| `drive_type = internship` and cap not consumed | **visible** (parallel track — placement status irrelevant) |

Confirmed decisions:
- Once the internship cap is consumed, the student is blocked from **both** `internship` **and** `internship_convertible` drives — even higher-category ones. The cap check precedes the ladder check.
- A placed student who has **not** consumed the cap still sees plain internship drives.
- A self-placed student's off-campus offer does **not** affect this ladder at all.

### R6 · `canApply(student, drive, offers, now) → { allowed, reason? }`
`isDriveVisibleToStudent` **AND** `now` within `[application_start, application_end]` **AND** not already applied.
**No withdrawal is ever permitted once applied.**

### R7 · `buildApplicationSnapshot(student, drive) → ApplicationSnapshot`
Deep-copies the full verified profile **plus the one resume matching `drive.role_category`**. Everything downstream — shortlisting, export, rounds, results — reads the snapshot. **Never the live profile.**

### R8 · `countAbsences(attendance) → number` and `needsDisbarmentReview(count) → boolean`
Counts `absent` records across **all drives, entire tenure**. No reset. No excused category. Only counts rounds the student was **scheduled** for. `needsDisbarmentReview` at **≥ 3**.
**Disbarment is never automatic** — it raises an alert for the Central CPC, who decides manually.

### R9 · `resolvePlacementRecord(offers) → Offer | null`
Highest `ctc_lpa` among `final_selected` offers. **Ties break to the earliest declared offer.** A Central CPC manual override always wins and is audit-logged.

### R10 · `fieldEditability(field, actorRole) → 'free' | 'requires_cpc_verification' | 'denied'`
No Admin-unlock workflow exists. CPC/Central CPC edits save instantly, audit-logged.

| Field group | Student | CPC / Central CPC |
|---|---|---|
| Interests, expertise, certifications, projects, skills, achievements, resumes, profile links | `free` | `free` |
| **New** semester CGPA / arrears (via Add Semester + marksheet) | `requires_cpc_verification` | `free` |
| **Verified** 10th, 12th, degree, branch, past semester CGPA / arrears | `denied` | `free` |

This preserves §7.2 (eligibility uses verified data only) while removing the unlock bureaucracy.

### R11 · `rankApplicants(applications, drive, weights) → RankedApplicant[]`
The MVP shortlisting provider: deterministic, weighted, **explainable**. Emits per-candidate reasoning derived from rule hits, satisfying PRD §13.1's audit requirement with zero AI cost. Inputs: CGPA, arrears, skill-repository scores, mandatory-skill match, role-preference match.

---

## 5. Attendance

- Marked **only** by CPC or Central CPC. Never the AE. Never the student (QR check-in is provisional only).
- Marked **only for students scheduled for that round** (i.e. `selected` in the prior round, or all applicants for round 1).
- Statuses: `scheduled` → `present` | `absent` | `provisional` (QR, awaiting confirmation).
- **Attendance page requires Select All / Unselect All.** (Confirmed in session.)
- Overrides permitted by CPC/Central CPC, always audit-logged.

---

## 6. Results and placement

- Round results: `selected` · `rejected` · `waitlisted` · `on_hold`.
- **Final selection is an explicit upload by the Central CPC** — not inferred from the last round. (Confirmed in session.)
- Final selection ⇒ student is **placed**. No separate accept/decline step in MVP.
- A placed student **continues all in-process drives** to completion, regardless of category ⇒ multiple offers are normal.
- Corrections may overturn any result: updates dashboards, notifies affected students, writes audit (before, after, reason).

---

## 7. Self-placed and opt-out

| | Rule |
|---|---|
| **Self-placed** | Student records off-campus offer + letter; CPC approves. Counts as a **separate statistic line**. Does **not** affect on-campus eligibility or the category ladder (confirmed). |
| **Opt-out** | Student-initiated **only** — never triggered by CGPA or any system rule. CPC approves. **Irreversible.** Excluded from all targeting and from the placement-percentage denominator; reported as a separate line. In-process drives continue. |

---

## 8. Audit

Append-only. `UPDATE`/`DELETE` revoked at the database level. Written by Postgres triggers, never by application code.

Every entry: `actor_id` · `timestamp` · `entity` · `action` · `before` · `after` · `reason`.

Covers: SRF approvals, semester verifications, PIF create/approve/reject, drive completion/publish, post-go-live edits, DAF targeting, shortlisting decisions **and** AI recommendations, recruiter exports (data-sharing log), round scheduling, result uploads and corrections, attendance changes and overrides, offer uploads, placement-record overrides, opt-out approvals, self-placed approvals, disbarment decisions.

---

## 9. Drive mode (PIF Q19)

| Code | Label |
|---|---|
| `on_campus` | On-campus |
| `physical_outside_campus` | Physical drive outside campus |
| `virtual` | Virtual |
| `pooled` | Pooled drive |

"Off-campus" is deliberately **not** used here — it is reserved for *self-placed* offers (§16.2).

---

## 10. Resolved decisions log

| # | Decision |
|---|---|
| Q1 | Delivery Head sets **both** `drive_type` and `offer_category` at approval. **Final** — the Central CPC cannot edit or change either. |
| Q2 | A consumed internship cap blocks **both** `internship` and `internship_convertible` drives. Cap is checked **before** the category ladder. |
| Q3 | Placement-record ties break to the **earliest declared** offer; Central CPC override still wins. |
| Q4 | No unlock workflow. CPC/Central CPC edit verified academic data directly and instantly (audit-logged). Students may **not** edit verified academic data; new semester data still requires CPC marksheet verification. |
| Q5 | Drive mode value is **"Physical drive outside campus"**, not "Off-campus". |

---

## 11. Build order

1. ✅ Scaffold repo + test harness; prove one red→green cycle.
2. Build `src/domain/` test-first: **R1 → R11**, 100% coverage, zero dependencies.
3. Only then does any UI get written.
