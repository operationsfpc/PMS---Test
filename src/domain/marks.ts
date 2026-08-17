/**
 * College marks arrive on two different scales.
 *
 * Asked for 2026-08-06: "some colleges have CGPA and some have % in college
 * marks. have an option for students to select relevant field and enter that."
 *
 * Every eligibility cutoff in this system is a CGPA on the 10-point scale
 * (`drives.min_overall_cgpa`), so a percentage must be converted before it can
 * be compared to anything at all. **That conversion decides who may apply to a
 * drive.** It therefore lives here, once, behind a single named constant,
 * rather than inline at the three call sites that would inevitably drift.
 *
 * What is stored follows from the same fact:
 *   - the DECLARED figure and its scale, because that is what the student
 *     typed and what a coordinator checks against the marksheet;
 *   - the NORMALISED CGPA, because that is what every cutoff is expressed in.
 * Keeping only one of the two would either lose the audit trail or make every
 * comparison re-derive a number it could get wrong.
 */

import type { ProgrammeLevel } from "./academics";
import { roundTo } from "./math";

export const MARKS_SCALES = ["cgpa", "percentage"] as const;
export type MarksScale = (typeof MARKS_SCALES)[number];

/**
 * ⚠️ ASSUMPTION — UNCONFIRMED (A33). The divisor that turns a percentage into
 * a CGPA. 9.5 is the common Indian convention (CBSE and most affiliating
 * universities): CGPA × 9.5 = percentage.
 *
 * Other universities use `(CGPA − 0.75) × 10`, which disagrees materially —
 * 80% is 8.42 here and 8.75 there, and at a cutoff of 8.5 those two answers
 * put the same student on opposite sides of eligibility. If the client's
 * colleges use a different formula, change this one constant.
 */
export const PERCENTAGE_TO_CGPA_DIVISOR = 9.5;

const CEILING: Readonly<Record<MarksScale, number>> = {
  cgpa: 10,
  percentage: 100,
};

export function isValidForScale(value: number, scale: MarksScale): boolean {
  return Number.isFinite(value) && value >= 0 && value <= CEILING[scale];
}

/**
 * The figure every cutoff is compared against, always on the 10-point scale.
 *
 * Rounded to two places because that is the precision the column stores
 * (`numeric(4,2)`); comparing an unrounded quotient against a stored value is
 * exactly how marks comparisons drift.
 */
export function normaliseToCgpa(value: number, scale: MarksScale): number {
  if (scale === "cgpa") return value;

  // Capped: 100 / 9.5 is 10.53, which is not a CGPA. Left uncapped it would
  // clear every cutoff ever set, including ones the student does not meet.
  return Math.min(10, roundTo(value / PERCENTAGE_TO_CGPA_DIVISOR, 2));
}

/**
 * WHICH COLLEGE the scale question is about (2026-08-18, answer 6a).
 *
 * One question governs every semester line, and for a postgraduate those lines
 * are their PG semesters - the finished UG degree carries its own figure on its
 * own scale. Asking a PG student "how does your UG college report marks" above
 * their PG semesters would collect the wrong answer, and a percentage stored as
 * a CGPA decides who is eligible for a drive.
 *
 * Here rather than in JSX so `src/copy.test.ts` can hold the wording, and so
 * the two questions cannot drift into saying the same thing.
 */
export function marksScaleQuestion(level: ProgrammeLevel): string {
  return level === "pg"
    ? "How does your PG college report marks?"
    : "How does your college report marks?";
}

/**
 * The completed undergraduate degree's own scale. It used to be labelled "UG
 * scale", which is a column heading, not a question - and it sat under a
 * question about a different college.
 */
export const UG_COLLEGE_MARKS_SCALE_QUESTION = "How does your UG college report marks?";

/**
 * How the figure is shown to a human.
 *
 * A coordinator verifying against a marksheet must see what the student
 * TYPED — a converted CGPA is a number they cannot find on the document.
 */
export function describeMarks(value: number, scale: MarksScale): string {
  return scale === "percentage" ? `${value}%` : `${value} CGPA`;
}
