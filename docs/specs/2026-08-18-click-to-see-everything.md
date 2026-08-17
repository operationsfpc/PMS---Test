# Spec — click to see everything · drive rounds · targeting · the student's four lists

**Status:** ⏳ AWAITING APPROVAL — seven items (N1–N7)
**Raised:** 2026-08-18, Karthik, in five messages after the first tranche shipped.
**Supersedes** `docs/specs/2026-08-17-drive-details-for-central-cpc.md`, which was awaiting
approval and is now the narrow case of N1.

---

## N1 — "Click to view complete information", as a rule for the whole application

> "while approving PIF, delivery head is shown only a few fields. This is fine from a display
> perspective. But delivery head should be able to click and view all relevant fields of the drive.
> apply this philosophy of clicking to view complete information everywhere in this application,
> wherever relevant."

**The principle, stated so it can be applied without asking again:** every list row that names a
thing is a **link to that thing's full record**. A summary row exists to help you choose; it must
never be the only place a fact is available.

**One canonical page per thing, reused by every role, with role-gated actions.** Not a detail panel
per screen — that is how six screens come to disagree about the same drive.

| The thing | Canonical page | Reached from |
|---|---|---|
| A drive | `/drives/:driveId` | PIF approval queue · Yet to publish · Live · Completed · shortlisting · rounds & results · the student's lists · campus Drive progress |
| A student | `/students/:studentId` | Verification queue · All students · shortlisting · Drive progress · attendance |
| An application | inside the drive page, per applicant | shortlisting · Drive progress |

The drive page shows, grouped: the company and role · compensation (CTC range, breakup, offer
category and who set it) · where and when (location, application window, the rounds) · the job
description as the AE wrote it · eligibility as published (CGPA or %, 10th/12th bars, arrears rule,
degrees, branches, passing years, mandatory skills) · provenance (raised / approved / published, by
whom and when).

**Read-only. Editing stays where it is** — the PIF for the AE, publish-and-target for the Central
CPC. A page that shows everything and edits nothing cannot leak a permission by accident.

Carried over from the superseded spec, now with recommendations rather than open questions:
- **Recruiter contact: hidden from everyone except the AE.** It is commercially sensitive and the
  AE owns the relationship.
- **Job description: plain text, whitespace preserved.** Rich text means accepting and sanitising
  HTML, which is a security decision, not a formatting one.
- **Print: not now.** Cheap to add later on a page that is already one column.

---

## N2 — the Drives sidebar is the same for every staff role

> "the side bar on drives should be similar for all people viewing it (other than students). just
> the edit rights will be different. view on side bar heading and subheading should be the same."

Every non-student role that sees drives at all gets the identical group:

```
Drives
  Yet to publish     approved, waiting to be published
  Live               live · applications_closed · in_rounds
  Completed          completed
```

Replacing today's per-role variants (`My drives`, `Drives I approved`, `Drive cockpit`).
**Only the actions differ**, and they already come from the domain — `canPublishDrive`,
`canShortlistFromPortfolio`, `canViewDriveApplicants`, `canApproveDrive`. Nothing about *what a
role may do* moves; the labels stop implying it.

⚠️ **One consequence to accept.** `/my-drives` was "drives I raised or approved", and these three
tabs are "drives, by status". An AE will now see the tabs — RLS still returns only their own
drives, so the contents are unchanged, but the heading no longer says "my". Q6 below.

---

## N3 — a "Now" box on the application window

> "in application window while making a live open. there should also be a now click box."

On publish-and-target, beside the window start: a checkbox **"Open now"**. Ticked, the start is the
moment of publishing and the field is disabled; unticked, it returns to a date-time input. The
domain owns "now" as an argument, never a call to `new Date()` inside a rule (CLAUDE.md), so the
stamp is taken once, at submit.

---

## N4 — targeting on 10th and 12th marks

> "we also need 10th and 12th marks based targetting. now only cgpa field is there."

Two more optional bars on a drive: `min_tenth_percentage`, `min_twelfth_percentage`. A student
clears the drive only if they clear **every** bar that is set.

🔴 **This is not a screen change.** `enforce_application_gates` (0041) is what actually stops an
ineligible application, and `publish-view` counts the audience. If the bars are added to the form
alone, the audience number and the apply gate disagree — the screen says 12 students and the
database lets in 30. So this is: domain rule → PIF/publish form → publish audience count → the
student's own "why can't I apply" reasons → **the RLS gate**, in one migration.

Compared against `students.tenth_percentage` / `twelfth_percentage`, which the SRF collects and the
coordinator verifies against the marksheet — the same figures the new board fields sit beside.

---

## N5 — the PIF's rounds become the drive's rounds

> "the drive round shown in PIF should get auto populated in drives shown in live/published drives
> with an ability to be edited. these are logical rounds to which students can progress."

Today the AE states a **count** (`drives.round_count`, F11) and the Central CPC creates rounds by
hand on the rounds screen; nothing connects the two, so a drive declared as 3 rounds can go live
with 0 and no student can be advanced.

At publish, materialise `round_count` rows in `drive_rounds` — `Round 1 … Round N`, no date, no
venue — then let the Central CPC rename them, date them, add one or remove an **unused** one. A
round that already has participants or results is not deletable: that is history, and 0043's
notifications have already told students about it.

---

## N6 — search on Drive progress (campus CPC)

> "Add a search bar to the Drive progress section for Campus Placement Coordinators … search for
> specific companies and monitor their ongoing drive progress without manual scrolling."

The same `searchDrives` predicate that shipped on the Live list this morning, on `/cpc/drives`.
One rule, so "hcl" means the same thing on every screen that lists drives.

---

## N7 — the student's Drives heading becomes four lists

> "while students login, the drive heading in side bar should be seggregated as follows (this is
> only for students. for all others, follow earlier instructions). Drives to Apply (here display
> time left to apply, have a search/filter options), Drives in progress (applied by them and in
> progress, show what round they are currently in, should have search and filter options), Not
> applied (should have search and filter options), Closed (should have search and filter options)."

| List | What is in it (my reading — **Q1**) | What each row shows |
|---|---|---|
| **Drives to apply** | Open to them, window still open, not yet applied | **Time left to apply** — "12 days left", "closes in 4 hours", urgent below 24h |
| **Drives in progress** | They applied, and it has not concluded | **Which round they are in now**, and their standing in it |
| **Not applied** | Window closed and they never applied | When it closed, and that the chance has gone |
| **Closed** | Concluded for them — completed drive, or their application ended (selected / not selected) | The outcome |

All four get **search** (company or role, the shipped predicate) and **filters**: role category ·
drive type (placement / internship) · CTC band. Mobile-first, because PRD §21.2 says students are
on phones.

A drive can be in exactly one list, and the four cover every case — otherwise a student has a
drive they cannot find, or sees the same one twice.

---

## Numbered questions

1. **N7's four lists** — is the table above right? The two I am least sure of: **Not applied** =
   "closed and I never applied" (a record of what I let pass), and **Closed** = "concluded,
   including the ones I did apply to". If you meant *Not applied* = "open, eligible, I have not
   applied yet", then it overlaps *Drives to apply* and I need to know which wins.
2. **N7 filters** — role category · drive type · CTC band enough, or do you want campus/location
   and "closing soon" as filters too?
3. **N4 — who sets the 10th/12th bars?** The **AE on the PIF** (it is the company's requirement,
   like the CGPA bar), the **Central CPC at publish**, or both? *Recommend: the AE declares it on
   the PIF, the Central CPC can adjust at publish — exactly how the CGPA bar already works.*
4. **N4 — comparison.** "At least X%", against the verified 10th/12th percentage on the student's
   record. Confirm, and confirm both bars are optional (a drive may set one, the other, or
   neither).
5. **N5 — round names.** Should the AE **name** the rounds on the PIF (Aptitude · Technical · HR),
   or keep declaring a count with names auto-generated as "Round 1…N" and renamed by the Central
   CPC? *Recommend naming them on the PIF: the AE heard it from the company, and "Round 2" tells a
   student nothing about what to prepare.*
6. **N2 — one label.** The three tabs are the same for every staff role, so an AE's heading is
   "Live", not "My drives". Fine? (RLS still shows them only their own drives.)
7. **N1 — order of work.** The drive page first, then the student page? Or is there a screen you
   are being asked about more often that should come first?
8. **N1 — one more place worth it.** On the shortlisting screen, clicking an applicant would open
   the **profile snapshot taken at apply time** (R7), not their live profile. That is the honest
   thing to show, and it is what the recruiter received. Include it?

---

## Also found while building this morning — not asked for, needs a decision

🔴 **P10. The SRF's role preferences and resumes are never stored.** The form collects up to five
role categories and demands a resume for each; `submit_srf` writes **neither**.
`student_role_preferences` has been an empty table since 0003, and the resume files are read only to
tick a box — the `File` is discarded. So R7 ("one resume per role category goes to the recruiter")
is fed entirely by whatever the student later uploads on `/student/profile`, and a student who has
only ever filled in the SRF has **no resume on file and no recorded preference** — while
`rankApplicants` scores role-preference match. Nobody has reported it because the profile page
quietly covers for it.

This is a bigger hole than anything in the two tranches above and I have deliberately **not**
folded it into either. It wants its own decision: does the SRF store them (migration + upload path),
or does the SRF stop pretending to collect them and send students to the profile page?
