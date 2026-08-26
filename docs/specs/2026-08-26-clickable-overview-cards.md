# Spec — Clickable cards on the Placement overview

**Date:** 2026-08-26
**Requested by:** Karthik (WhatsApp screenshot `docs/inbox/WhatsApp Image 2026-08-24 at 17.04.11.jpeg`)
**Approved:** answers 1a · 2 as recommended · 3 yes · 4a · 5b · 6b

> "make the cards in Placement Overview (Campus & Central Placement Coordinator,
> Delivery Head and Account Executive view) clickable to show student info,
> just like in Live Drives"

## The pattern being copied

`src/features/drive-portfolio/portfolio-page.tsx` wraps each `StatCard` in a
`<Link to={/drives/:id?stage=…}>`, so every number opens exactly the people it
counted. The Placement overview (`src/features/dashboard/dashboard-page.tsx`)
does this for one row only — the funnel's "Placed" — and everything else is
dead text.

## 1. What becomes clickable (answer 1a + 6b)

| Card / row | Destination |
|---|---|
| Placement rate | `/central/students?filter=on_campus` |
| Placed on campus | `/central/students?filter=on_campus` |
| Self-placed | `/central/students?filter=self_placed` |
| Opted out | `/central/students?filter=opted_out` |
| Drives completed | `/central/drives/completed` |
| On the roster | `/central/students` |
| Registration form submitted | `/central/students?filter=submitted` |
| Verified by a coordinator | `/central/students?filter=verified` |
| Placed *(already linked)* | `/central/students?filter=on_campus` — **repointed, see §2** |
| Package: Highest / Median / Lowest | `?filter=placed&ctc=<figure>` |
| Package: Average | `?filter=placed` (no student *is* the average) |
| Package by category rows | `?filter=placed&category=<category>` |
| Offers by category rows | `?filter=placed&category=<category>` |
| By campus rows | `?campus=<campus name>` |

Every students link carries `&campus=<name>` when the overview's campus
switcher is set (answer 4a).

Out of scope: "Drives by status" (a drive list, not student info, and only
three of its eight statuses have a tab) and the per-drive "Drive progress"
box (that *is* the Live-drives view).

## 2. The bug this exposed (answer 3)

The overview's **Placed on campus** counts `hasOnCampusPlacement` — self-placed
excluded, PRD §16.2. The directory's `filter=placed` counts *any* placement
record, self-placed included (C1, deliberate there). So the existing "Placed"
link already lands on a **longer list than the number clicked**.

Fix: two new, exact filters.

- `on_campus` — holds an on-campus placement record. Identical population to
  `hasOnCampusPlacement`.
- `self_placed` — holds *any* self-placed offer. Identical population to
  `hasSelfPlacement`, which is why `DirectoryStudent` gains a
  `hasSelfPlacement` fact: a student holding both an on-campus and a
  self-placed offer displays the on-campus one, and would otherwise be missing
  from the list their own Self-placed card counted.

`placed` keeps its C1 meaning and is still the tab a coordinator clicks.

## 3. New directory filters and parameters

`DirectoryFilter` gains `on_campus`, `self_placed`, `submitted`, `verified`.

`submitted` and `verified` must be the **same predicate** the funnel counts
with, cumulative evidence included (a student who applied was necessarily
verified, whatever their status column now says). `registrationFunnel` exports
`countsAsSubmitted` / `countsAsVerified` and both modules call them — two
copies would drift and the count would stop matching the row clicked.

`DirectoryQuery` gains:

- `campus` — exact campus name, case-insensitive.
- `ctc` — placement CTC equal to this figure, compared with `sameMoney`
  (new tolerance helper in `src/domain/math.ts`; never `===` on money).
- `category` — the placement's offer category.

All of them compose with `filter` and the search box.

**Never land on an empty list:** a package figure links to `&ctc=…` only when
some placed student actually holds that figure; otherwise it links to the
placed list. Median of an even-sized cohort is the midpoint of two packages and
frequently belongs to nobody.

**Known scoping note:** "Offers by category" counts *offer rows*; the directory
counts *students* by their one displayed placement. A student with two offers
in a category is 2 there and 1 here. Documented at both call sites.

## 4. Student directory changes

- Filter chips extended to the full set, so a filter arriving by URL is always
  visible and reversible.
- A campus `<select>`, populated from the loaded rows, bound to `?campus=`.
- `ctc` / `category` render as dismissible context badges — they are
  drill-downs, not permanent filters.
- All of it stays in the URL: a coordinator can send someone the exact view.

## 5. ⚠️ BLOCKED — the Account Executive (answer 5b)

Answer 5b cannot be built as written, and this was only provable by reading the
policies:

- An AE is neither `is_org_reader()` nor `is_campus_reader()`
  (`supabase/migrations/0018_campus_scoped_readers.sql`), so
  `select from students` returns **zero rows** for them. `portfolio-view.ts`
  says so in as many words: *"an Account Executive has no read policy on
  students"* — it reads applicant names from the application snapshot instead.
- Therefore `/dashboard` for an AE renders "No students yet. Import a campus
  roster to begin.", and `/central/students` renders an empty table. Giving
  them the sidebar entry ships a blank screen.

Three ways forward, put to Karthik:

1. Leave the AE as they are — their Live/Completed drive cards already are the
   clickable pattern, scoped to their own drives. No new access.
2. Build a small AE overview from data they can already read (their drives and
   applicants): Drives raised / Applicants / Shortlisted / Offers, each opening
   `/central/drives/…?stage=…`. New screen ⇒ mockup first. No RLS change.
3. Widen RLS so an AE may read the `students` and `offers` rows of students who
   applied to drives they raised. New migration + pgTAP for every role × table,
   and a real widening of who can see student records.

Everything else in this spec ships regardless of that answer.

## 6. Test plan (TDD, RED first)

| Layer | Test |
|---|---|
| `src/domain/math.test.ts` | `sameMoney` tolerance, incl. `0.1+0.2` |
| `src/domain/registration-funnel.test.ts` | exported predicates agree with the stages |
| `src/domain/student-directory.test.ts` | each new filter; `campus`/`ctc`/`category` compose; on-campus ≠ placed |
| `src/features/dashboard/dashboard-page.test.tsx` | every card is a link, to the right href, campus carried |
| `src/features/central-cpc/students-page.test.tsx` | every arriving param filters and is reversible |
