# Spec — Drive details for the Central Placement Coordinator

**Status: AWAITING APPROVAL. Not built.**
Raised by Karthik, 2026-08-17. Everything else from that conversation shipped;
this is the one item that is a new screen, so it gets a spec first.

> "As a Central Placement Coordinator, I want to view full details (such as job
> role, job description, compensation, and location) of drives published by
> Account Executives, so that I can review all relevant drive information and
> manage the placement process effectively."

---

## The problem, stated plainly

The Central CPC's lists — Yet to publish, Published, All drives — show
**company, role title, status and applicant count** and nothing else. Every
other fact the AE entered on the PIF (the job description, the compensation
breakup, the location, the eligibility bar) is only visible inside
**Publish and target**, which is an *editing* screen for a drive that has not
gone out yet.

So today, to answer "what did we actually promise this company?" for a drive
that is already live, the coordinator has no screen at all.

## What I propose

A **read-only drive detail view** at `/central/drives/:driveId`, reached by
clicking the company name in any of the three lists.

It shows, in one column, grouped:

1. **The company and the role** — company, role title, role category, drive type
2. **Compensation** — CTC range in LPA, the free-text breakup, offer category and who set it
3. **Where and when** — location(s), application window, round schedule
4. **The job description** — as the AE wrote it
5. **Eligibility as published** — CGPA bar, arrears rule, allowed degrees/branches/passing years
6. **Provenance** — raised by whom and when, approved by whom, published by whom

Nothing on it is editable. Editing stays where it is.

---

## Numbered questions — please answer with the numbers

1. **Reach.** Should this also be visible to the **Delivery Head** (who
   approved the commercials) and the **campus CPC** (who is fielding student
   questions about the drive)? My instinct is yes for both, read-only. You said
   "as a Central Placement Coordinator", so I have not assumed it.

2. **The AE.** Should the AE see this detail view for their own drives? It is
   their own PIF content, so I would say yes — but you have just made the AE
   read-only, and I do not want to widen them by accident.

3. **The job description.** The PIF stores it as free text. Do you want it
   rendered as plain text (safe, ugly for long JDs) or with basic formatting —
   headings, bullets? Formatting means we accept and sanitise rich text, which
   is a bigger change.

4. **Compensation detail.** Do you want the **stipend** and **internship
   duration** fields shown here too when the drive type is an internship, or is
   this screen only about full-time roles?

5. **Location.** The PIF today holds location as a single free-text field. Do
   you want it kept that way, or should it become a proper list (multi-city
   drives are common and "Chennai / Bangalore / Pune" as one string cannot be
   filtered on later)? This one has a schema consequence, so it is worth
   deciding now rather than after.

6. **Recruiter contact.** The PIF captures the company contact. Should that
   appear here? It is commercially sensitive and the AE owns the relationship —
   I would default to **hiding** it from everyone except the AE.

7. **Print / share.** Is "print this drive as a one-pager" something you need,
   e.g. to send to a campus? Cheap to add now, awkward to retrofit.

8. **Entry point.** Clicking the **company name** in the existing lists — does
   that match how you would look for it? The alternative is an explicit
   "View details" link on each row.

---

## What I will do once these are answered

1. Write the failing tests for the view model — which fields, which order,
   which are hidden from which role.
2. Build the read-only screen against MSW.
3. Add the RLS read policy to match, so the screen and the database agree.
4. Show you the screen on the live URL before calling it done.

**Estimate:** small — one screen, no new writes — *unless* question 5 turns
location into a list, which adds a migration and a change to the PIF form.
