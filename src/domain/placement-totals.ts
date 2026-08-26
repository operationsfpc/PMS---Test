/**
 * The organisation's placement figures, from counts rather than from rows.
 *
 * Option A, approved 2026-08-26: an Account Executive may see the
 * organisation's NUMBERS and never a student record, so the database hands
 * them aggregates. The rate itself stays here — `computePlacementStats` is
 * still the rule for anyone holding the rows, and both must publish the same
 * percentage or two screens quote two figures from one database.
 *
 * `src/domain/placement-totals.test.ts` pins them together, and
 * `src/db/placement-totals.test.ts` pins the SQL to both.
 */

import { percentOf } from "./math";

export interface PlacementCounts {
  /** Everyone still participating — opt-outs have already left this number. */
  readonly eligible: number;
  readonly placed: number;
  readonly selfPlaced: number;
  readonly optedOut: number;
  readonly completedDrives: number;
}

export interface PlacementTotals extends PlacementCounts {
  readonly placementRate: number;
}

export function summarisePlacementTotals(counts: PlacementCounts): PlacementTotals {
  return { ...counts, placementRate: percentOf(counts.placed, counts.eligible) };
}
