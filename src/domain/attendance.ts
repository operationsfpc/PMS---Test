/**
 * R8 — Attendance and the absence ladder. PRD §15.
 *
 * Absences accumulate across ALL drives for the student's entire tenure.
 * No reset. No excused category. Disbarment is never automatic — reaching the
 * limit only raises a review alert for the Central CPC (PRD §15.2).
 */

import type { AttendanceStatus, RoundResult } from "./types";

/** Three cumulative absences trigger a Central CPC review. */
export const ABSENCE_LIMIT = 3;

export interface AttendanceRecord {
  readonly driveId: string;
  readonly roundId: string;
  readonly status: AttendanceStatus;
}

/**
 * Counts confirmed absences only.
 *
 * `provisional` (an unconfirmed QR self check-in) and `scheduled` (a round that
 * has not happened yet) never count against a student.
 */
export function countAbsences(records: readonly AttendanceRecord[]): number {
  return records.filter((r) => r.status === "absent").length;
}

/** Raises the manual disbarment review. Never disbars by itself. */
export function needsDisbarmentReview(absenceCount: number): boolean {
  return absenceCount >= ABSENCE_LIMIT;
}

/**
 * Decision Q10 — only a `selected` result advances a student to the next round.
 * `waitlisted` and `on_hold` students must first be promoted by the Central CPC.
 *
 * Round 1 is not governed by this: participants are chosen by the RECRUITER from
 * the exported applicant list, then uploaded by the Central CPC (decision Q9).
 */
export function isScheduledForNextRound(previousResult: RoundResult): boolean {
  return previousResult === "selected";
}
