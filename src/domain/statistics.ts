import type { ParticipationStatus } from "./types";

export interface StudentPlacementFacts {
  readonly studentId: string;
  readonly participationStatus: ParticipationStatus;
  /** At least one on-campus placement or internship-convertible offer. */
  readonly hasOnCampusPlacement: boolean;
  /** At least one approved off-campus offer they found themselves. */
  readonly hasSelfPlacement: boolean;
}

export interface PlacementStatsInput {
  readonly students: readonly StudentPlacementFacts[];
}

export interface PlacementStats {
  /** The denominator: everyone still participating. */
  readonly eligible: number;
  readonly placed: number;
  readonly placementRate: number;
  readonly optedOut: number;
  readonly selfPlaced: number;
}

/** One decimal: 1 of 3 must not print as 33.33333333333333. */
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The four populations as predicates (2026-10-16).
 *
 * A card that shows a count now opens the people behind it, and the list must
 * be the SAME population the number counted. Computing it a second time in a
 * component is how a popup ends up longer than the figure that opened it — the
 * defect the AE overview shipped with. `computePlacementStats` below is written
 * in terms of these, so there is one definition of each.
 */
export const hasOptedOut = (student: StudentPlacementFacts): boolean =>
  student.participationStatus === "opted_out";

/**
 * Still in the process — the denominator, and every card labelled "eligible".
 *
 * Opting out is the only status that leaves. A held student stays counted: the
 * college can release them on a Tuesday, and a rate that moved because someone
 * set a review date would not be the college's placement rate any more.
 */
export const countsInPlacementDenominator = (student: StudentPlacementFacts): boolean =>
  !hasOptedOut(student);

/** An on-campus offer, and still participating: the placement record (R9). */
export const isPlacedOnCampus = (student: StudentPlacementFacts): boolean =>
  countsInPlacementDenominator(student) && student.hasOnCampusPlacement;

/** Their own find, reported on its own line and never as an on-campus placement. */
export const isSelfPlaced = (student: StudentPlacementFacts): boolean => student.hasSelfPlacement;

/**
 * Placement statistics (domain model 7).
 *
 * The denominator is the number everyone argues about, so it lives here with
 * tests rather than in a SELECT somebody quietly tweaks before a board
 * meeting.
 *
 *  - An OPTED-OUT student leaves the denominator entirely and is reported on
 *    their own line. They chose not to participate; counting them as unplaced
 *    would misreport the team's work.
 *  - A DISBARRED student stays in. Disbarment is a sanction, not a
 *    withdrawal, and removing them would flatter the rate by punishing the
 *    student twice.
 *  - A SELF-PLACED offer is its own line and never an on-campus placement
 *    (PRD 16.2).
 */
export function computePlacementStats(input: PlacementStatsInput): PlacementStats {
  const optedOut = input.students.filter(hasOptedOut).length;
  const selfPlaced = input.students.filter(isSelfPlaced).length;

  const counted = input.students.filter(countsInPlacementDenominator);
  const placed = counted.filter((s) => s.hasOnCampusPlacement).length;

  return {
    eligible: counted.length,
    placed,
    placementRate: counted.length === 0 ? 0 : round1((placed / counted.length) * 100),
    optedOut,
    selfPlaced,
  };
}
