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
