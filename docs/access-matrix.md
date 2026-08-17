# Who can see and do what — as built

**Generated from the code on 2026-08-17, not from the PRD.** Every row was read
out of `src/components/app-shell.tsx` (sidebar), `src/app.tsx` (route guards),
`src/domain/*.ts` (the rules themselves) and `supabase/migrations/*.sql` (RLS).
Where the built system differs from the PRD, the built system is what is
written here and the difference is called out.

> Re-check this file whenever a permission changes. It is documentation, so
> nothing enforces it — the enforcing is done by the domain functions and the
> RLS policies it cites.

---

## 1. The eleven roles

| # | Role | Exists to | Lands on |
|---|---|---|---|
| 1 | `admin` | Set up the org: campuses, staff, roster | `/dashboard` |
| 2 | `student` | Register, apply, attend, accept | `/student` — or `/srf` if not yet registered |
| 3 | `campus_placement_coordinator` (CPC) | Verify their campus's students; run attendance | `/dashboard` |
| 4 | `account_executive` (AE) | Bring in the company and raise the PIF | `/my-drives` |
| 5 | `delivery_head` | Approve or reject the PIF, and fix the offer category | `/dashboard` |
| 6 | `central_placement_coordinator` (Central CPC) | Publish, shortlist, run rounds, record offers | `/dashboard` |
| 7 | `campus_manager` | Read the numbers for their campuses | `/dashboard` |
| 8 | `key_account_manager` (KAM) | Read the numbers for their accounts | `/dashboard` |
| 9 | `enterprise_relations` (ER) | Read the numbers | `/dashboard` |
| 10 | `er_head` | Read the numbers (read-only by design) | `/dashboard` |
| 11 | `ceo` | Read everything | `/dashboard` |

Roles 7–11 are **read-only reporting roles**. They share one dashboard on
purpose: RLS decides how many rows each gets back, so a Campus Manager simply
sees fewer than a CEO. Building five screens would be five chances to compute
"placed" differently.

**Only the Central CPC exists once** in the MVP. Everyone else can be many.

---

## 2. What each role sees in the sidebar

Exactly as built. Groups are collapsed except the one in use, and `Overview` is
first wherever it exists.

### `admin`
- **Overview** → Placement overview
- **Organisation** → Campuses · Staff · Import roster

### `student`
- **Home** → My dashboard
- **Drives** → Open drives
- **My record** → My registration form · My profile
- **Requests** → Opting out · Off-campus offer

### `campus_placement_coordinator`
- **Overview** → Campus overview
- **Verification** → Student verification · Certificate verification
- **Drives in progress** → Drive progress *(read-only)* · Attendance
- **Requests** → Opt-out requests · Off-campus offers

### `account_executive`
- **Drive initiation** → Position information form
- **My drives** → My drives

### `delivery_head`
- **Overview** → Placement overview
- **Drive approval** → PIF approvals
- **Drives** → My drives · Drive cockpit *(read-only since 2026-08-17)*

### `central_placement_coordinator`
- **Overview** → Placement overview
- **Drives** → Yet to publish · Published · All drives
- **Publish a drive** → Publish and target · Skill repository
- **Drives in progress** → Shortlisting · Rounds & results · Attendance · Final selection
- **Requests** → Opt-out requests · Off-campus offers

### `campus_manager` · `key_account_manager` · `enterprise_relations` · `er_head` · `ceo`
- **Overview** → one dashboard, titled for the role

---

## 3. The permission matrix

`✅` allowed · `👁` read-only · `—` not available

| Capability | Rule in code | admin | student | CPC | AE | Delivery Head | Central CPC | CM/KAM/ER/ER-head/CEO |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Invite staff | `canInviteRole` | ✅ | — | — | — | — | — | — |
| Change a staff role / remove staff | `canChangeStaffRole`, `canRemoveStaff` | ✅ | — | — | — | — | — | — |
| Import a roster | route `/admin/roster` | ✅ | — | — | — | — | — | — |
| Submit the registration form (SRF) | `srf-access.ts` | — | ✅ | — | — | — | — | — |
| Verify SRF / certificates | `CampusCpcOnly` guard + RLS `0042` | — | — | ✅ | — | — | — | — |
| **Raise a drive (PIF)** | `canRaiseDrive` + RLS `0047` | **—** | — | — | ✅ | **—** | **—** | — |
| **Approve / reject a PIF** | `canApproveDrive` | **—** | — | — | **—** | ✅ | **—** | — |
| **Set the offer category** | `classifyOfferCategory` suggests; DH decides | — | — | — | — | ✅ | — | — |
| **Publish a drive** | `canPublishDrive` | — | — | — | — | **—** | ✅ | — |
| **Shortlist applicants** | `canShortlistFromPortfolio` | — | — | ✅ | **—** | **—** | ✅ | — |
| **View the drive portfolio applicant list** | `canViewDriveApplicants` | — | — | — | ✅ | **—** | **—** | — |
| Apply to a drive | `canApply` | — | ✅ | — | — | — | — | — |
| Mark attendance | `canMarkAttendance` | — | — | ✅ | — | — | ✅ | — |
| Record a round result | `canRecordResult` | — | — | — | — | — | ✅ | — |
| Approve an opt-out / off-campus offer | `canApproveParticipationChange` | — | — | ✅ | — | — | ✅ | — |
| Export the recruiter pack | `/central/shortlisting` | — | — | ✅ | — | — | ✅ | — |
| Placement overview | `/dashboard` | ✅ | — | ✅ | **—** | ✅ | ✅ | ✅ |
| Drive progress | `/cpc/drives`, `/central/drives` | — | — | 👁 | 👁 *(own)* | 👁 | ✅ | — |

### The drive lifecycle: three verbs, three roles, no overlaps

    raise -> account_executive    approve -> delivery_head    publish -> central_cpc

Enforced in the domain (`canRaiseDrive` / `canApproveDrive` / `canPublishDrive`),
at the route, and since **0047** in RLS. Admin holds **none** of the three: being
able to fix anything is not a reason to be able to do everything.

An AE sees only the drives they raised — `drives_ae_read` scopes on
`created_by = auth.uid()`.

### The five changes made on 2026-08-17

1. **The AE cannot publish or shortlist.** The drive cockpit left their
   sidebar; `/central/publish` and `/central/shortlisting` refuse them at the
   route.
2. **The Delivery Head cannot publish.** `canPublishDrive` is Central CPC only.
   Approving the commercials is not announcing the drive.
3. **The portfolio applicant list is the AE's alone.** The Delivery Head and
   the Central CPC could open it; they no longer can. They still see the funnel
   **counts** — a coordinator needs to know a drive has two applicants — but
   not the roll of names.
4. **A band edge belongs to the band above it.** ₹5.00 LPA is Dream, ₹10.00 LPA
   is Super Dream.
5. **The overview is the landing page** for every role except the student and
   the AE.

---

## 4. Campus scoping

`campusScopeFor` in `src/domain/staff.ts`:

| Scope | Roles | Meaning |
|---|---|---|
| `one` | `campus_placement_coordinator` | Exactly one campus. Their queues show only their own students. |
| `many` | `campus_manager`, `key_account_manager` | Several campuses, listed on their account. |
| `none` | everyone else | Not campus-bound. |

A coordinator with no campus mapped is told so in the sidebar, because
otherwise every queue they open is empty and reads as a quiet week rather than
a broken account.

---

## 5. Two things worth knowing

**The AE has no read policy on students.** This is why they have no Overview
entry and do not land on one: a placement overview would render zeroes and look
broken. Their drives are their overview.

**⚠️ The UI guards are still partly ahead of the database.** Raising a drive is
now enforced in RLS (**0047**, with tests in `src/db/drive-lifecycle-roles.test.ts`).
**Publish, shortlist and the applicant list are still browser-and-route only** —
a crafted request could get further than the UI allows. Close these before
launch; it is the top open item in `docs/HANDOVER.md`.
