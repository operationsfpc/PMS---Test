# Spec — the Account Executive's landing page

**Date:** 2026-08-26
**Requested by:** Karthik — "AE GETS a landing page · option 2 scoped as above ·
give them wider access of all placement overall numbers, number done by them and
drives brought in by them"
**Status:** ⏳ awaiting approval of the mockup + the access question in §4

---

## 1. Why the AE had nothing

`/dashboard` is one component shared by Central CPC, campus CPC, Delivery Head,
Campus Manager, KAM, CEO and ER. Every number on it is computed from the
**student roster**, and an Account Executive cannot read `students` at all —
they match neither `is_org_reader()` nor `is_campus_reader()` (`0018`). Handing
them that screen renders "No students yet. Import a campus roster to begin."

What they CAN already read, for drives they raised (`0018`, `0019`):
applications, the applicant's name from the frozen snapshot, shortlist
inclusion, and offers. That is why their Live-drives cards work.

## 2. The screen

**Route** `/ae/overview` · **Sidebar** a new "Overview → My overview", first
entry, above Drive initiation. A new screen rather than a variant of the shared
one: the two answer different questions, and one component pretending to do
both is how the placement rate ends up computed over an AE's applicant list.

### Section A — "My drives" (their own work)

Six figures, all from rows the AE already reads. No new access.

| Card | Means | Opens |
|---|---|---|
| Drives brought in | every drive they raised | `/central/drives/live` (their portfolio) |
| Live now | published, still open | Live tab |
| Applicants | applications across their drives | Live tab |
| Shortlisted | included in a shortlist | Live tab |
| Offers made | offers declared on their drives | Completed tab |
| Drives completed | reached `completed` | Completed tab |

Beneath them, their five most recent drives — company, role, and the
applied → shortlisted → offers line each already carries on Live, each opening
the drive.

### Section B — "Placement overall" (the org's numbers)

The figures the Central CPC's overview leads with, as **totals only**:

- Placement rate · Placed on campus · Self-placed · Opted out · Eligible
- Drives completed across the org
- Package: highest · average · median · lowest

**Not clickable.** Every card on the shared overview opens the student
directory; these must not, because the AE may not read it. A link that lands on
an empty list is worse than a number that never claimed to be one.

## 3. Where the numbers come from

Section A: `drives`, `applications`, `shortlist_entries`, `offers`, all already
readable, all already scoped to the AE by RLS. The domain does the counting —
`summariseFunnel` (drive-portfolio) and `driveProgress`, both already tested.

Section B: `computePlacementStats` and `summariseCtc` — the SAME domain
functions the Central CPC's screen calls, so the AE quotes the organisation's
number and not a second opinion. What changes is only where the rows come from.

## 4. ⚠️ THE DECISION — how the AE gets the org numbers

They cannot read `students` or org-wide `offers`. Two ways to change that:

**Option A — aggregates only (recommended).** One `security definer` function
returning a single row of counts: eligible, placed, self-placed, opted out,
completed drives, and the four package figures. The AE receives **numbers and
never a student record**. Your 2026-08-17 rule — "the AE should only be able to
view the students shortlisted or selected on their drives" — stays exactly as
written, because names still come only from their own drives.
Cost: one migration + pgTAP proving an AE gets totals and still gets zero rows
from `students`.

**Option B — make the AE an org reader.** One line in `is_org_reader()`. It also
hands them All students, the skill repository, every student's CGPA, email and
phone, org-wide, and reverses the 2026-08-17 rule.
Cost: one line, and a much larger blast radius.

You asked for "all placement overall **numbers**". Option A is that, precisely.
Option B is that plus every student record in the system, which is not what the
sentence says and not what an AE needs to answer a client.

**Recommended: A.** Say the word if you actually want B — it is genuinely
smaller to build, and I will say so in the handover either way.

## 5. Out of scope

- No campus breakdown for the AE: campus-by-campus performance is the delivery
  side's conversation, and the org total is what a client asks about.
- No student names anywhere outside their own drives' applicant lists.
- Nothing changes for any other role.

## 6. Test plan (TDD, RED first)

| Layer | Test |
|---|---|
| `src/domain/ae-overview.test.ts` | the six "my drives" figures, incl. a drive with no applicants and an AE with no drives |
| `src/features/ae/overview-page.test.tsx` | both sections render; org cards are NOT links; every "my drives" card is |
| `src/features/ae/overview-view.test.ts` | the AE's own rows are read scoped; the org totals come from the aggregate |
| `supabase/tests` (pgTAP) | an AE gets the totals AND still reads zero rows from `students` — the whole point of Option A |
| `src/components/app-shell.test.tsx` | the AE sidebar gains Overview, and no other role changes |
