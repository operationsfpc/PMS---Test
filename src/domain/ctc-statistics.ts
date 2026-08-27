/**
 * CTC reporting. PRD §17 — the figures every stakeholder dashboard quotes.
 *
 * ONE FIGURE PER PLACED STUDENT. The input is a student's placement record
 * (R9 — `resolvePlacementRecord`), never their offer rows. A student holding
 * three offers who is averaged three times inflates the package, disagrees
 * with the "placed" count printed beside it, and flatters the team's work.
 * That is precisely the number that gets quoted in a board meeting, so the
 * shape of the input enforces the rule: one record, keyed by student.
 */

import { roundMoney } from "./math";
import { LADDER_CATEGORIES, type OfferCategory } from "./offer-category";

export interface PlacementCtc {
  readonly studentId: string;
  readonly ctcLpa: number;
  /** Null for a plain internship, which is not on the ladder (PRD §11). */
  readonly category: OfferCategory | null;
}

export interface CtcStatistics {
  readonly count: number;
  /** Null rather than 0 when nobody is placed: zero is a real CTC. */
  readonly highestLpa: number | null;
  readonly lowestLpa: number | null;
  readonly averageLpa: number | null;
  readonly medianLpa: number | null;
}

const EMPTY: CtcStatistics = {
  count: 0,
  highestLpa: null,
  lowestLpa: null,
  averageLpa: null,
  medianLpa: null,
};

/**
 * The headline package figures.
 *
 * Both the average and the median are published because they answer different
 * questions and disagree in exactly the case that matters: one enormous
 * package moves the average and leaves the median where it was. Quoting only
 * the average is how a cohort where most students earn ₹6 LPA gets reported
 * as earning ₹19.5.
 */
export function summariseCtc(records: readonly PlacementCtc[]): CtcStatistics {
  if (records.length === 0) return EMPTY;

  const sorted = records.map((r) => r.ctcLpa).sort((a, b) => a - b);
  const total = sorted.reduce((sum, ctc) => sum + ctc, 0);

  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;

  return {
    count: sorted.length,
    lowestLpa: sorted[0] as number,
    highestLpa: sorted[sorted.length - 1] as number,
    averageLpa: roundMoney(total / sorted.length),
    medianLpa: roundMoney(median),
  };
}

export interface CtcByCategory {
  readonly category: OfferCategory;
  readonly stats: CtcStatistics;
}

/**
 * The same figures per rung of the ladder, lowest rung first.
 *
 * A category nobody holds is omitted rather than shown as a row of dashes: an
 * empty row invites the reader to wonder whether it is a data problem.
 *
 * Only the LADDER has rungs. Internships — whether they carry no category, as
 * before 2026-08-27, or the `internship` one added that day — are counted in
 * the headline and appear on no rung, because they are on no rung. A stipend
 * and a salary do not belong in the same table.
 */
export function summariseCtcByCategory(records: readonly PlacementCtc[]): readonly CtcByCategory[] {
  return LADDER_CATEGORIES.flatMap((category) => {
    const inCategory = records.filter((r) => r.category === category);
    return inCategory.length === 0 ? [] : [{ category, stats: summariseCtc(inCategory) }];
  });
}
