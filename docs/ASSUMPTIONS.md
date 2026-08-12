# Assumptions Register

Every decision taken **without** confirmation, so each is cheap to find and
reverse. Each is also marked `⚠️ ASSUMPTION — UNCONFIRMED` at its call site.

Authorised 2026-08-02: *"wherever required, you make necessary assumptions"*.

**Reversal cost** is what it would take to change the decision later:
🟢 minutes · 🟡 a screen or a migration · 🔴 schema + data already collected.

| # | Area | Assumption | Cost |
|---|---|---|---|
| A1 | SRF resubmission | A rejected student may edit and resubmit; the CPC sees a fresh `srf_submitted`. History lives in the audit log | 🟢 |
| A2 | Marksheets | Uploads are required to submit the SRF. No "submit now, upload later" | 🟡 |
| A3 | Student landing | A student always lands on `/student`, even pre-SRF | 🟢 |
| A4 | Degree / branch | Admin-managed tables, not the 6 hardcoded degrees in PIF Q13 | 🔴 |
| A5 | Roster format | `public/templates/student-roster-template.xlsx` is canonical. Authorised 2026-08-02 | 🟡 |
| A6 | Role landing | Roles with no screen get an honest "not built yet" page | 🟢 |
| A7 | Skill scores | R11 `rankApplicants` schema invented — see A12 | 🔴 |
| A8 | City / state | `state` lives on `cities`, not on `campuses`; a city determines its state | 🟡 |
| A9 | Campus code | Unique **globally**, free format | 🟡 |
| A10 | City entry | Typed on the campus form and resolved-or-created by name, never a dropdown — a dropdown is empty on day one and rebuilds the bootstrap deadlock | 🟢 |
| A11 | Branch import | A **blank** branch cell imports as null (some degrees have none); a **non-blank unknown** branch is refused, exactly as an unknown degree is. Silent nulling would break R2 branch eligibility invisibly | 🟡 |
| A12 | Skill score shape | `skill_scores(student_id, skill, score 0–100, assessed_at)`. R11 weights CGPA 40 / skill match 30 / arrears 15 / role-preference 15, all admin-tunable. **Invented — replace when the real schema arrives** | 🔴 |
| A13 | Staff invite | An Admin may invite **any** role including another Admin (confirmed). Campus assignment happens on the same screen | 🟢 |
| A14 | Staff removal | ~~Staff are deactivated, never deleted~~ **Superseded 2026-08-04** — see A25 | 🟡 |
| A15 | Result corrections | A corrected round result **replaces** the row and writes the previous value to the audit log, rather than appending a second result. One student, one round, one current result | 🟡 |
| A16 | Offer CTC | Pre-filled from the drive's `ctc_max_lpa ?? ctc_min_lpa` and editable per student, since the actual figure decides the placement record (R9) | 🟢 |
| A17 | Offer letter | Not required at declaration. Declaration is metadata; the letter may be attached later | 🟡 |
| A18 | Self-placed | Requires an offer letter upload, because there is no drive to corroborate it | 🟡 |
| A19 | Opt-out | Student raises a request with a reason; CPC approves. Irreversible on approval, per the domain model | 🟡 |
| A20 | Dashboards | CEO / KAM / ER / Campus Manager dashboards are **read-only** aggregates. No drill-down editing | 🟢 |
| A21 | Notifications | Written to a `notifications` table and shown in-app. Email delivery is deferred behind `EmailProvider` — see PENDING P1 | 🟡 |
| A22 | Recruiter export | CSV + a manifest, not XLSX/ZIP, until a spreadsheet library is agreed — see PENDING P2 | 🟢 |
| A23 | Absence review | At 3 absences the student is **flagged for review** on the Central CPC's screen. Never auto-disbarred (domain model R8) | 🟢 |
| A24 | Round creation | The Central CPC defines rounds at publish time and may add a round later while the drive is `in_rounds` | 🟡 |
| A25 | Staff removal | **Supersedes A14** (user request, 2026-08-04). An Admin may **change a role** and **remove** a staff member outright. Removal deletes the invitation (the login allowlist entry), any staged campuses, and the profile. Postgres refuses the profile delete when drives/offers/results still reference them, and the UI then says "deactivate instead", so PRD §19 attribution survives. The `auth.users` row is **not** deleted (the browser cannot), but with no profile they resolve to nobody and are locked out | 🟡 |
| A27 | PG's UG result | A postgraduate's single UG aggregate is stored as a **CGPA on the 10-point scale** (`students.ug_aggregate_cgpa`), not a percentage. "One line for UG marks" did not say which. Reversible while no PG student has registered | 🟡 |
| A28 | Fallback CGPA | While a student has **no verified semester**, eligibility falls back to the roster's `overall_cgpa`. The alternative — treating them as ineligible for everything — would have locked out all 3 live students the moment this shipped | 🟢 |
| A26 | Last Admin | An Admin may not change their own role, remove their own account, or demote/remove the **last active Admin**. A deactivated Admin does not count as cover | 🟢 |
| A29 | Enterprise Relations scope | `enterprise_relations` reads **organisation-wide**, mirroring `er_head`, which already did. ER is a company-facing role, so campus assignment would not describe their work. Before 0018 they matched no policy at all and saw zero students. Reversible: remove them from `is_org_reader()` | 🟡 |
| A30 | AE drive visibility | The AE who **raised** a drive may read its applications, its shortlist and its offers — that drive only, select-only. Their portfolio otherwise reports a confident zero rather than nothing. Applicant identity comes from `profile_snapshot`, so an AE still cannot read the `students` table | 🟡 |

## A31 — a postgraduate evidences their UG aggregate with a consolidated marksheet

⚠️ **ASSUMPTION — UNCONFIRMED.** A PG student declares one aggregate CGPA
standing in for an entire completed degree (0017). Unevidenced it is the
largest unverifiable figure on the form, so it is now required like any other
declared mark: `document_kind.ug_consolidated_marksheet` and
`students.ug_marksheet_id` (0023).

What is unconfirmed is whether a *consolidated* marksheet is the document a PG
student can actually produce — some universities issue only per-semester UG
marksheets and a degree certificate. Cheap to reverse: stop requiring the slot
in `src/domain/marksheets.ts` and the column simply goes unused.

Call sites: `src/domain/marksheets.ts` (`requiredMarksheets`),
`supabase/migrations/0023_marksheet_evidence.sql`.

## A32 — a rejected registration form lands on the dashboard, not the form

⚠️ **ASSUMPTION — UNCONFIRMED.** "When a student logs in for the first time, he
should directly land on the registration page" (2026-08-06) is implemented for
`invited` and `registered` — a student who has never submitted.

A student whose form was **rejected** still lands on `/student`, because the
dashboard is the only screen that shows the coordinator's reason for sending it
back; landing straight on the form would hide it behind a back-navigation. They
get a prompt with a direct link.

Reverse by returning `/srf` for `srf_rejected` in `studentLandingRoute`
(`src/domain/auth-routing.ts`) — one line, one test.

## A33 — percentage → CGPA uses a divisor of 9.5

⚠️ **ASSUMPTION — UNCONFIRMED, AND IT DECIDES ELIGIBILITY.**

"Some colleges have CGPA and some have % in college marks" (2026-08-06). Every
cutoff in this system is a CGPA on the 10-point scale
(`drives.min_overall_cgpa`), so a declared percentage must be converted before
it can be compared to anything.

`PERCENTAGE_TO_CGPA_DIVISOR = 9.5` in `src/domain/marks.ts` — the common Indian
convention (CBSE and most affiliating universities).

**Other universities use `(CGPA − 0.75) × 10`, which disagrees materially.**
80% is 8.42 under 9.5 and 8.75 under the other. At a cutoff of 8.5 those two
answers put the same student on opposite sides of eligibility. Confirm the
formula the client's colleges use.

Both figures are stored so this stays reversible: `declared_marks` +
`marks_scale` (what the student typed, what the coordinator verifies) and
`cgpa` (normalised, what cutoffs compare). Changing the constant and
recomputing `cgpa` is a one-column backfill.

## A34 — up to eight "other" profiles

⚠️ **ASSUMPTION — UNCONFIRMED.** `MAX_OTHER_PROFILES = 8` in
`src/domain/profile-links.ts`. Past that a recruiter stops reading and it
starts to look like padding. Nothing depends on the exact number; it is one
constant.

Related decision, not an assumption: the **value is not validated as a URL**.
The request was "mention the url/user name" (2026-08-06), and a Codeforces
handle is not a URL — demanding one would refuse exactly the entries the field
exists to capture.

## A34 — the plausible range for a year of passing (UAT 2026-08-06, F6)

`campus_programmes.passing_year` must be between **2015 and 2100**.

⚠️ **ASSUMPTION — UNCONFIRMED.** Nothing in the PRD or the PIF states a bound.
The range is wide enough for a cohort that graduated five years ago and one
starting next year, and narrow enough to refuse a typo like `2072` reaching a
student's dropdown.

Stated twice on purpose — `src/domain/programmes.ts` and
`supabase/migrations/0036_campus_programmes.sql` — because the screen and the
database must refuse the same values. **Change both, or neither.**

## A35 — a skill-repository score is 0–100, at most two decimals (refines A12)

⚠️ **ASSUMPTION — UNCONFIRMED.** The client named the skill AREAS on
2026-08-06 (Aptitude, Communication skills, Fundamentals of Programming, Data
Structures and Algorithms, GitHub strength, Programming skills, AI skills,
AI-assisted Full Stack Development — "more can be added") but not the SCALE.
0–100 was chosen because R11 already normalises to it and a percentage-like
scale needs no explanation on a screen.

Stated twice on purpose — `parseSkillScore` in `src/domain/skills.ts` and
`score_within_scale` in `supabase/migrations/0037_skill_repository.sql`.
Changing the scale is one constant, one check constraint and a backfill.

The invented `skill_scores` table (A12) is **dropped** by 0037: this request
was the real schema arriving. Shortlisting (R11) now reads the repository.

## A37 — ✅ ANSWERED 2026-08-06: BOTH, and the evidence moved with it

**The client chose the bundled behaviour:** *"make approving the registration
form also confirm the certificates that came with it, and keep the standing
queue for later uploads."*

So it is now both, and the reading below is superseded:

- **Approving the form verifies the certificates submitted with it** —
  `0039`, modelled on `0031`'s semester trigger. Already-rejected and
  already-verified certificates are left alone; nobody else's are touched.
- **Anything uploaded afterwards stays `pending`** and goes to
  `/cpc/certificates`, which is what makes a certificate earned in the final
  semester verifiable at all.

🔴 **The condition that made this safe to build.** Bundling was pushed back on
first, because the verification queue did not show certificate documents — one
click would have certified files the coordinator was never shown, which is
exactly the hole that made semester verification meaningless before `0023`.
The screen change shipped **with** `0039`, not after it: each certificate now
sits beside a signed link to its document, and the approve button states how
many certificates it is about to verify.

The original reading, kept because it explains why the queue exists at all:

⚠️ **ASSUMPTION — SUPERSEDED.** The request (2026-08-06) was "skill
 certifications uploaded by students will also need verification of campus
placement coordinator **similar to CGPA approval**. This is applicable for
first upload as well as subsequent additions."

"Similar to CGPA approval" is read as **the same standing** — a coordinator
checks the claim against the document — and NOT as *at the same moment*. A
CGPA is verified when the form is approved (0031); a certificate is verified
on its own, in `/cpc/certificates`.

The second sentence forces it. The profile page has accepted certificates
since F20, including long after approval, so bundling verification into the
form's approval would leave every later upload with no path at all — and
"subsequent additions" is half the request. One mechanism covers both, which
is also why a student's certificate list is not gated on their SRF status.

Reversible: verifying at approval as well would be a trigger like 0031's.

## A36 — students do not see their institutional skill scores

⚠️ **ASSUMPTION — UNCONFIRMED.** No RLS read policy on
`student_skill_scores` admits a student. PRD §5 calls the repository
institutional and internal-only, and its scores feed a shortlist whose status
is "never visible to students" — a visible "GitHub strength 34" would leak
the evaluation the shortlist is built on. Cheap to reverse: one read policy.

## A38 — waitlisted and on-hold round results do not notify

⚠️ ASSUMPTION — UNCONFIRMED (2026-08-12). The client asked that cleared AND
rejected round results reach the student ("can be communicated through
notification"). Waitlisted/on-hold are interim states — notifying "you are
waitlisted" and then "you are selected" reads as two decisions where there was
one. The dashboard shows the interim state; only outcomes notify.

One trigger branch to add (`round_result_reaches_student`, 0043) if reversed.
