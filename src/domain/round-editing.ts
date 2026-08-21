/**
 * Renaming and removing a drive's rounds after publish. Batch B2
 * (2026-08-21, answer 2): "drive rounds may also get eliminated once a
 * company's placement drive starts."
 *
 * The 0055 freeze principle, extended from a round's logistics to its name
 * and its existence: a round with any recorded fact is history, and history
 * does not get edited. Mirrored server-side by 0057's trigger; change both
 * or neither.
 */

import type { AppRole } from "./types";

export interface RoundFacts {
  /** Students scheduled into the round (round_participants). */
  readonly hasParticipants: boolean;
  readonly hasAttendance: boolean;
  readonly hasResults: boolean;
}

/**
 * Why this round cannot be renamed or removed — or null when it can.
 *
 * The STRONGEST fact wins the wording: "results are recorded" tells the
 * coordinator more than "students are scheduled", and both may be true.
 */
export function describeRoundFreeze(facts: RoundFacts): string | null {
  if (facts.hasResults) return "Frozen — results are recorded in this round.";
  if (facts.hasAttendance) return "Frozen — attendance is recorded in this round.";
  if (facts.hasParticipants) return "Frozen — students are scheduled into this round.";
  return null;
}

/** One verb, one role (0047): the rounds are the Central CPC's to manage. */
export function canManageRounds(role: AppRole): boolean {
  return role === "central_placement_coordinator";
}

export interface NumberedRound {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
}

/**
 * The rounds that remain after removing one, renumbered to close the gap —
 * the PIF form's rule (numbers are positional), applied to a live drive.
 * "Round 3 of 2" is not something a student can prepare for.
 */
export function renumberRounds(
  rounds: readonly NumberedRound[],
  removeRoundId: string,
): readonly NumberedRound[] {
  return rounds
    .filter((round) => round.roundId !== removeRoundId)
    .map((round, index) => ({ ...round, sequence: index + 1 }));
}
