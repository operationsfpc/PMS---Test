/**
 * The drive-specific funnel. F5 (UAT 2026-08-06), PRD §17.
 *
 * "Applied to a drive is drive specific data. The other 4 are not drive
 * specific. There has to be another box to track drive specific data ...
 * eligible students (students to whom a drive is opened), applied students,
 * attendance and clearance in each round till final offer."
 *
 * Everything here is measured against ONE drive: the audience it was published
 * to, and then the people still standing after each round. It deliberately
 * shares no stage with `registration-funnel.ts` — the two answer different
 * questions and have different denominators, and putting them in one list is
 * what made the old fourth row meaningless.
 */

import { conversionRate } from "./drive-analytics";
import type { AttendanceStatus, RoundResult } from "./types";

export interface RoundParticipant {
  readonly studentId: string;
  readonly attendance: AttendanceStatus;
  /** Null until the Central CPC records one. */
  readonly result: RoundResult | null;
}

export interface DriveRoundParticipation {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
  readonly participants: readonly RoundParticipant[];
}

export interface DriveParticipation {
  /** Students the drive was actually opened to — R5, not the roster. */
  readonly eligible: number;
  readonly applied: number;
  readonly shortlisted: number;
  readonly rounds: readonly DriveRoundParticipation[];
  /** Final offers out of this drive. */
  readonly offers: number;
}

export interface RoundProgress {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
  /** Everyone called to the round, whatever happened next. */
  readonly scheduled: number;
  readonly present: number;
  readonly absent: number;
  /** Called, but neither confirmed present nor confirmed absent. */
  readonly unconfirmed: number;
  /** Only `selected` clears a round (Q10). */
  readonly cleared: number;
  readonly attendanceRate: number;
  readonly clearanceRate: number;
}

export interface DriveFunnelStage {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface DriveFunnel {
  readonly eligible: number;
  readonly applied: number;
  readonly shortlisted: number;
  readonly rounds: readonly RoundProgress[];
  readonly offers: number;
  readonly applicationRate: number;
  readonly offerRate: number;
  /** Left to right, the whole drive on one line. */
  readonly stages: readonly DriveFunnelStage[];
}

function progressOf(round: DriveRoundParticipation): RoundProgress {
  const scheduled = round.participants.length;
  const present = round.participants.filter((p) => p.attendance === "present").length;
  const absent = round.participants.filter((p) => p.attendance === "absent").length;
  const cleared = round.participants.filter((p) => p.result === "selected").length;

  return {
    roundId: round.roundId,
    sequence: round.sequence,
    name: round.name,
    scheduled,
    present,
    absent,
    // `scheduled` (not yet held) and `provisional` (a QR scan nobody has
    // confirmed) are both "we do not know yet", and saying so is what gets
    // them confirmed.
    unconfirmed: scheduled - present - absent,
    cleared,
    attendanceRate: conversionRate(present, scheduled),
    // Measured against who turned up: a student who never attended did not
    // fail the round, and counting them makes the round look like a filter it
    // was not.
    clearanceRate: conversionRate(cleared, present),
  };
}

export function driveFunnel(participation: DriveParticipation): DriveFunnel {
  const rounds = [...participation.rounds].sort((a, b) => a.sequence - b.sequence).map(progressOf);

  return {
    eligible: participation.eligible,
    applied: participation.applied,
    shortlisted: participation.shortlisted,
    rounds,
    offers: participation.offers,
    applicationRate: conversionRate(participation.applied, participation.eligible),
    offerRate: conversionRate(participation.offers, participation.applied),
    stages: [
      { key: "eligible", label: "Eligible", count: participation.eligible },
      { key: "applied", label: "Applied", count: participation.applied },
      { key: "shortlisted", label: "Shortlisted", count: participation.shortlisted },
      ...rounds.map((round) => ({
        key: round.roundId,
        label: `${round.sequence}. ${round.name}`,
        // The number who CLEARED, so the row below is the population the next
        // round draws from. The number called is on the round's own line.
        count: round.cleared,
      })),
      { key: "offers", label: "Final offer", count: participation.offers },
    ],
  };
}
