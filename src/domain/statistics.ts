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
  const optedOut = input.students.filter((s) => s.participationStatus === "opted_out").length;
  const selfPlaced = input.students.filter((s) => s.hasSelfPlacement).length;

  const counted = input.students.filter((s) => s.participationStatus !== "opted_out");
  const placed = counted.filter((s) => s.hasOnCampusPlacement).length;

  return {
    eligible: counted.length,
    placed,
    placementRate: counted.length === 0 ? 0 : round1((placed / counted.length) * 100),
    optedOut,
    selfPlaced,
  };
}
