# SRF Dropdown Synchronization & Field Label Validation Bug Fixes

**Date:** 2026-09-11  
**Status:** Implemented & Verified  
**Scope:** Student Registration Form (`src/features/srf/`), Domain Rules (`src/domain/`), Form Component System (`src/components/form.tsx`)

---

## 1. Executive Summary

When students filled fields using dropdown options and later modified previously selected values, old data was persisting in form state or hidden conditional fields. Additionally, validation states were disconnected from field labels, leaving students confused as to which exact field was missing or invalid.

This update resolves all dropdown synchronization bugs, sanitizes obsolete conditional state (both on live dropdown change and during draft merge), and implements prominent, accessible field label validation highlighting that automatically clears upon correction.

---

## 2. Issues Identified & Resolutions

| # | Reported Issue | Root Cause | Fix Implemented |
|---|----------------|------------|-----------------|
| 1 | **Stale Conditional Data on Dropdown Change** | Changing school board (e.g. from State Board with a state selected, to CBSE) kept `tenthBoardState` in form state. Zod superRefine would fail or submit contradictory payload. | Added dedicated `onChange` handlers for 10th and 12th boards (`handleTenthBoardChange`, `handleTwelfthBoardChange`) that reset obsolete conditional fields (`tenthBoardState`, `tenthBoardOther`, `tenthGrade`) and immediately trigger revalidation. |
| 2 | **Stale PG Fields on Programme Level Switch** | Switching from PG back to UG kept `ugDegree`, `ugCollege`, `ugBranch`, `ugAggregate`, and `ug_consolidated` marksheet in form state. | Added `handleProgrammeLevelChange` that clears all completed UG degree fields, strips `ug_consolidated` marksheet, and re-validates form state. |
| 3 | **Stale Scale Mismatch on Scale Dropdown Switch** | Changing college marks scale between CGPA and Percentage did not immediately re-evaluate semester marks until form submission. | Added `handleCollegeMarksScaleChange` that updates form state and immediately triggers revalidation across all semester marks inputs and array rules. |
| 4 | **Old Saved Drafts Polluted with Stale Data** | Previously saved student drafts contained orphaned state/other values from earlier selections, causing unexplainable validation blocks upon resume. | Added `sanitizeConditionalSrfValues(values)` in `src/domain/srf-draft.ts` to sanitize obsolete conditional fields during draft merge. |
| 5 | **Field Label Validation Highlighting** | Field labels remained plain grey even when inputs failed validation or were empty. | Updated `Field` in `src/components/form.tsx`, `BoardSelect`, and `ScaleSelect` in `src/features/srf/srf-page.tsx` so that labels dynamically receive bold danger styling (`font-semibold text-danger-700`) and an accessible `Invalid` badge when an error occurs. |
| 6 | **Auto-Clearing Label Highlighting** | Error indicators lingered or required page refresh. | Integrated `trigger` validation on dropdown changes and real-time input change, immediately clearing label and input highlighting as soon as valid input is entered. |
| 7 | **Duplicate Error Text in Testing Library & DOM** | Redundant `<ErrorText>` elements underneath fields that already rendered errors through `Field` caused duplicate alert text in the DOM. | Consolidated error display so each field renders its accessible alert message via `Field`, `BoardSelect`, or `ScaleSelect`, eliminating DOM duplicates while keeping array-level summaries. |

---

## 3. Technical Verification & Test Results

- **Vitest SRF Test Suite:** All **44 tests passed** (`npx vitest run src/features/srf/srf-form.test.tsx` in 71s).
- **TypeScript Typecheck:** Passed cleanly (`npm run typecheck` returned exit code 0).
- **New Unit Tests Added:**
  1. `dropdown values correctly replace previously selected values and sanitize obsolete conditional fields` — verifies switching 10th board from State Board (Kerala) to CBSE removes state field and submits clean payload.
  2. `highlights field label when invalid or empty and clears highlighting when corrected` — verifies `text-danger-700` and `Invalid` badge on label and real-time clearing when valid input is typed.
  3. `changing college marks scale immediately triggers revalidation` — verifies changing scale from Percentage to CGPA immediately revalidates marks without requiring submit button click.
