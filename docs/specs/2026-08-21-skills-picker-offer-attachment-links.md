# Spec — PIF skills picker · final-selection attachment · clickable notification links

Date: 2026-08-21 (evening). Status: **ALL THREE PARTS SHIPPED 2026-08-24.**
A (0058) with the skills rework; B (0062, answers 1a–1d: yes · PDF/JPG/PNG
≤5MB · staff-with-offer + student · attach-later yes) and C ("2 go") in the
evening batch. The Skills assessed page (1a/2a/3a) shipped as 0059.
Source: Karthik's message + screenshot `docs/inbox/Screenshot 2026-08-21 at 4.27.41 PM.png`
(student notifications with plain-text URLs).

---

## A — PIF "Mandatory skills" becomes a picker over the skill repository

**Problem proven live:** the drive said `mandatory_skills = "Coding, Testing"`
(free text) while the repository's 8 areas have other names — so every
applicant reads "Scored on 0 of 2 required skills" no matter how strong they
are. Free text invites names the matcher cannot match.

**Change (AE's PIF form, `src/features/pif/`):**

- The free-text input is replaced by **checkboxes over the live `skill_areas`
  catalogue** (fetched at form load, alphabetical). New areas added to the
  repository later appear automatically — no code change.
- Below the checkboxes, an **"Other skills"** add-row (type a name, press
  Add, shows as a removable chip). For skills beyond the catalogue. These
  will match nothing in ranking until an identically-named area is added to
  the repository — stated in a help line under the control:
  *"Skills outside the repository can't be scored until they are assessed
  and added to the Skill repository."*
- **Storage unchanged:** the selections + others are comma-joined into the
  existing `drives.mandatory_skills` text column. Everything downstream
  (shortlist chips, `rankApplicants` matching, record page, publish line)
  already reads that shape. No data migration.
- **Draft/rejected reload:** stored text is split; names matching a
  catalogue area (case-insensitive) re-tick the box; the rest become
  "other" chips. Nothing is dropped.
- **Migration 0058 (part 1):** `skill_areas_ae_read` — SELECT on
  `skill_areas` for `account_executive`. Names only; student **scores**
  remain unreadable to the AE (0037's score policy untouched).

**Layout (in place of the current input, same card):**

```
Mandatory skills
[✓] AI skills            [ ] AI-assisted Full Stack Development
[ ] Aptitude             [✓] Communication skills
[ ] Data Structures…     [ ] Fundamentals of Programming
[ ] GitHub strength      [ ] Programming skills
Other skills:  [ Testing          ] [Add]   (Coding ×)
ℹ Skills outside the repository can't be scored until they are
  assessed and added to the Skill repository.
```

---

## B — Attach a file while marking a candidate as final selection

**Change (`src/features/central-cpc/offer-page.tsx` + offers repository):**

- Each undeclared candidate row gains an **optional** "Attach offer letter"
  file input beside the CTC field. Declared rows show the file name as a
  link (signed, expiring URL) or "No file attached".
- **Storage:** new private bucket `offer-letters`, path
  `<student_uuid>/<drive_uuid>/<filename>`. Upload runs BEFORE the insert
  (the 0051 order — an orphan object is cheap; a row pointing at nothing
  hands someone a dead link).
- **Migration 0058 (part 2):** `offers.attachment_path text` (nullable) +
  a whole-path check (the 0051 `jd_attachment_is_whole` pattern), bucket +
  policies.

**Questions (numbered, with recommendations):**

1. **File types/size** — recommend PDF + JPG/PNG, ≤ 5 MB (offer letters
   arrive as PDFs and as photographed/screenshotted mails).
2. **Who may view it** — recommend: staff who can read the offer row
   (org readers; campus readers for their own students) **and the student
   the offer belongs to**. Say (a) staff only if students must not see it.
3. **Attach later?** — recommend yes: a declared row with no file shows
   "Attach file…" so a letter that arrives after declaration can still be
   filed. (He said "an option to attach WHILE marking" — the late-attach is
   my addition; drop it if unwanted.)

---

## C — Links in student notifications become clickable

**Problem (screenshot):** bodies like "Join at: https://meet.google.com/…"
render as dead text on `/student/notifications` and the dashboard panel.

**Change:**

- New pure fn `linkifyBody(body): readonly Segment[]` in
  `src/domain/notifications.ts` — splits a body into text and `https?://`
  URL segments (trailing punctuation `.,;)` stays text, so "…workers.dev/."
  doesn't 404).
- Both renderers (`notifications-page.tsx`, `student-dashboard.tsx` panel)
  render URL segments as `<a target="_blank" rel="noopener noreferrer">`,
  brand-coloured, underlined.
- No DB change; notification bodies are written by triggers and stay text.

---

## Build order (TDD, one commit per part)

C (pure frontend, ships alone) → A (domain split/join + form + 0058 part 1)
→ B (0058 part 2 + bucket + page). 0058 lands once, carrying both parts;
PGlite db tests for the AE read policy, the attachment check and bucket
policies; live proof after push.
