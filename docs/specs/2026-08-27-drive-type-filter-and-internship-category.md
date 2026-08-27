# Spec — drive-type filter, type tags, stipend at approval, and the Internship category

**Raised:** Karthik, 2026-08-27 (`docs/inbox/WhatsApp Image 2026-08-27 at 15.56.45.jpeg`)
**Status:** ✅ **APPROVED 2026-08-27** — building
**Answers:** 1 → A · 2 → yes · 3 → internship only · 4 → my proposal · 5 → yes · 6 → all five · 7 → correct · 8 → relax it
**Pushback round, all four accepted:**

| # | Decision |
|---|---|
| **PB1** | The enum value is added **`before 'regular'`**. `ALTER TYPE ADD VALUE` appends by default, which would sort Internship **above Super Dream** — no code exploits enum ordering today (all four SQL ladders use an explicit `CASE`), but the first `max(offer_category)` anyone writes would block a student from every drive. Lowest fails safe. |
| **PB2** | `internship` is **mandatory**, not merely allowed: for `drive_type = 'internship'` both `drives.offer_category` and `offers.offer_category` **must** be `'internship'`. NULL previously meant "plain internship" and keeping both would leave one fact with two spellings for ever. Karthik: *"all data is test so far"* — production carries **13 offers, none an internship**, so this is free exactly once. |
| **PB3** | On the student card, the category badge is **suppressed when it merely repeats the type tag** — no "Internship Internship". |
| **PB4** | `0043`'s offer notification reads **"…has made you an internship offer."** rather than the generic "…has made you an offer (internship)." |

---

## 1. What was asked

1. A **filter by drive type** at the top of every screen that lists ongoing/live drives.
2. A **small type tag** on each drive summary card.
3. The **stipend** shown to the Delivery Head when approving an internship PIF — currently missing.
4. A fourth offer category, **Internship**, beside Regular / Dream / Super Dream.

---

## 2. Two things found in the code that change the shape of #4

### 2a. The database already forbids exactly what #4 asks for

`0004_drives.sql` and `0006_outcomes.sql` both carry:

```sql
constraint internship_has_no_category
  check (drive_type is distinct from 'internship' or offer_category is null),
```

> *"Plain internships are not on the category ladder (PRD §11)."*

So storing `offer_category = 'internship'` is not an addition — it is a **reversal of a stated rule**, and the constraint must be replaced, not dropped. The replacement encodes answer 3 in the database:

```sql
-- An internship drive may carry NO category, or the internship one — nothing else.
-- Every other drive type may carry any rung, but never 'internship'.
check (
  case drive_type
    when 'internship' then offer_category is null or offer_category = 'internship'
    else offer_category is distinct from 'internship'
  end
)
```

### 2b. `Regular / Dream / Super Dream` are a ranked ladder, `Internship` is not a rung

`offerCategoryRank` drives R5 visibility, R9 placement records, the dashboard's CTC-by-category rows and the student-directory filter. The answer (design A) is therefore **two constants, not one**:

| Constant | Members | Used by |
|---|---|---|
| `OFFER_CATEGORIES` | regular · dream · super_dream · **internship** | storage, validation, the PIF dropdown |
| `LADDER_CATEGORIES` | regular · dream · super_dream | `offerCategoryRank`, R5, R9, CTC statistics, directory filter |

`offerCategoryRank('internship')` **throws** — an unranked value must never be silently ranked lowest. Adding the member to the union makes TypeScript flag every exhaustive site, which is the point of design A: the compiler finds the call sites, not me.

`classifyOfferCategory` and `suggestOfferCategory` can never return `internship` — they band a CTC, and an internship has none.

### 2c. Offers carry it too (answer 2, tightened by PB2)

`offers.offer_category` is written from the drive (`offers-repository.ts:92`), and an internship offer now carries `'internship'` — **required**, not optional.

The ladder is unaffected: both the TypeScript (`ladderOffers`) and the SQL gates filter by `drive_type in ('placement','internship_convertible')` **before** they ever look at a category, so an internship offer cannot enter a ranking. Verified in `0041`, `0050`, `0054`, `0056`.

`offers` constraints to replace:

```sql
-- 0006: internship_has_no_category  — becomes internship_carries_internship_category
check (
  case drive_type
    when 'internship' then offer_category = 'internship'
    else offer_category is distinct from 'internship'
  end
)
-- 0014's ladder_offer_has_category still holds: every on-campus offer has a category.
```

---

## 3. Naming — one spelling, everywhere (answer 4)

New domain function `driveTypeLabel(type)` in `src/domain/drive-type.ts`:

| Stored value | Label |
|---|---|
| `placement` | **Full time** |
| `internship_convertible` | **Internship → Full time** |
| `internship` | **Internship** |

Replaces four separate spellings in the codebase today: `"Internship (convertible)"` (PIF form), the same again (student profile), `drive_type.replaceAll("_", " ")` → *"internship convertible"* (publish view), and the raw value on the portfolio card. **The PIF form's "Placement" becomes "Full time" too** — one word for one thing.

---

## 4. The filter (answer 5) and the tag

**Domain:** `matchesDriveType(driveType, filter)` in `src/domain/drive-type.ts`, where `filter` is `"" | DriveType`. Empty matches everything. One predicate so no two screens disagree about what "Internship" contains.

**Portfolio / cockpit screens** — a row of chips directly under the search box:

```
Search drives  [ .................... ] [ Search ]

Type   ( All )  ( Full time )  ( Internship → Full time )  ( Internship )
```

- single-select, default **All**
- selected chip: `--primary` fill, white text; others: outline
- kept in the URL as `?type=internship`, so a filtered list is shareable and survives a refresh
- the count in the empty state names the filter: *"No internship drives here yet."*

**Student drives screen** — that page already has a row of `<select>`s (location · area · closing soon). A chip row would fight them, so the filter there is a **`<select>` labelled "Drive type"** in the same row, same options. Behaviour identical.

**The tag** — a small `Badge` on every drive summary card, beside the company name:

| Type | Tone |
|---|---|
| Full time | `neutral` |
| Internship → Full time | `accent` (violet) |
| Internship | `warning` (amber) |

### The five screens (answer 6)

| # | Screen | Component | Roles |
|---|---|---|---|
| 1 | Live | `drive-portfolio/portfolio-page.tsx` | AE · Delivery Head · Central CPC |
| 2 | Yet to publish | `central-cpc/cockpit-page.tsx` | Central CPC · Delivery Head |
| 3 | Completed | `drive-portfolio/portfolio-page.tsx` (same component) | as #1 |
| 4 | Student drives | `student/drive-tabs.tsx` (+ `drives-list.tsx`) | Student |
| 5 | Campus drive progress | `cpc/drive-progress-page.tsx` | Campus CPC · Campus Manager |

Each of the five view layers must also start selecting `drive_type` — **four of them do not fetch it today.**

---

## 5. Stipend at approval (answer 7)

`describeStipendRange(minMonthly, maxMonthly)` in `src/domain/stipend.ts`, mirroring `describeCtcRange`:

- `(15000, 20000)` → `₹15,000–20,000 / month`
- `(15000, null)` → `₹15,000 / month`
- `(null, null)` → `null`

Indian digit grouping (`en-IN`), because ₹1,50,000 and ₹150,000 are read at different speeds by the person approving it.

Shown on **both** decision surfaces — the PIF approval queue card and the cockpit's approve dialog — beside the CTC line, whenever a stipend exists. That includes `internship_convertible` drives: **3 live ones carry both a CTC and a stipend**, and the Delivery Head is approving both numbers.

`stipend_min_monthly` / `stipend_max_monthly` are added to `approval-repository.COLUMNS` and to the cockpit view's select.

A drive with neither CTC nor stipend reads **"No CTC or stipend recorded"** — never a blank space where a number should be.

---

## 6. The go-live gate (answer 8)

`missingBeforeGoLive` and the database's `live_requires_complete_record` both demand `ctc_min_lpa`. Both internship drives in production have a stipend and no CTC, so **neither can be published today**.

New rule, in the domain and mirrored in the database:

> A drive must carry **a CTC or a stipend**. For `drive_type = 'internship'` a stipend satisfies it; for every other type the CTC is still required.

The domain message becomes *"Minimum CTC (LPA), or a monthly stipend for an internship"*.

The database's live gate is rewritten in the same migration — the domain and the constraint must never disagree about what "ready" means.

This closes blocker **P10**.

---

## 7. Migrations

`ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds it, so this is **two migrations**:

| # | Contents |
|---|---|
| **0066** | `alter type offer_category add value 'internship' before 'regular';` — nothing else (PB1) |
| **0067** | replace `internship_has_no_category` on **`drives`** (§2a) and on **`offers`** (§2c) · rewrite `live_requires_complete_record` (§6) · reword the offer notification (PB4) · `comment on` each, stating why |

---

## 8. Test plan (TDD — red first, every item)

**Domain (100% required)**
- `driveTypeLabel` — every member; the union is exhaustive so a new type breaks the build.
- `matchesDriveType` — each type, and "" matching all.
- `offerCategoryRank('internship')` **throws**; `LADDER_CATEGORIES` excludes it.
- `classifyOfferCategory` / `suggestOfferCategory` never return `internship`.
- `describeStipendRange` — range, single, none, Indian grouping.
- `missingBeforeGoLive` — internship with a stipend and no CTC is **ready**; internship with neither is not; placement with a stipend and no CTC is **not** ready.

**Components**
- Each of the five screens: filtering to a type shows only that type; All restores; the tag renders per type.
- Approval queue and cockpit: the stipend is on screen for an internship PIF; the category dropdown offers **only Internship** for `drive_type = 'internship'` and only the three rungs otherwise.
- Regression: the CTC-less internship PIF (today's outage) still lists.

**Database (pgTAP / PGlite)**
- an internship drive accepts `null` and `'internship'`, rejects `'dream'`
- a placement drive rejects `'internship'`
- an internship with a stipend and no CTC can reach `live`; with neither, it cannot

---

## 9. Explicitly NOT in this change

- `offers.offer_category` and the offers constraint (§2c)
- the ladder itself — R5 visibility and R9 placement records are untouched, and an internship still consumes only the internship cap (R4)
- the dashboard's CTC-by-category rows — they iterate `LADDER_CATEGORIES`, so no "Internship" row appears
- back-filling the two live internship drives — they are `submitted`; the Delivery Head classifies them by hand

---

## 10. Approve?

Reply **"approved"** (or with numbered changes). Then I build it end to end, run the suite, migrate, deploy, verify, and report.
