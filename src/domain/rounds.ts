import type { AppRole, RoundResult } from "./types";

export interface ParticipantResult {
  readonly studentId: string;
  readonly result: RoundResult;
}

export type Permission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** Only these two roles ever touch attendance or results (domain-model §5). */
const OPERATORS: readonly AppRole[] = [
  "campus_placement_coordinator",
  "central_placement_coordinator",
];

/**
 * Q10 - who is scheduled for the next round.
 *
 * Only `selected` advances. `waitlisted` and `on_hold` are deliberately not
 * scheduled: the Central CPC must first promote them to `selected`, which
 * makes the promotion an explicit, auditable act rather than a side effect of
 * the next round being created.
 */
export function advancingParticipants(results: readonly ParticipantResult[]): readonly string[] {
  return results.filter((r) => r.result === "selected").map((r) => r.studentId);
}

export interface RoundParticipation {
  readonly sequence: number;
  readonly applicationIds: readonly string[];
}

/**
 * F1 (UAT 2026-08-19) — round progression is strictly linear.
 *
 * The applications that sit in any round AFTER `sequence`. Their results in
 * `sequence` (and every earlier round) are history: a student in Round 3 got
 * there THROUGH Round 2's `selected`, and re-recording Round 2 as `rejected`
 * would leave them participating in a round their own record says they never
 * reached. The screen renders their earlier results read-only.
 */
export function advancedBeyond(
  sequence: number,
  rounds: readonly RoundParticipation[],
): ReadonlySet<string> {
  const locked = new Set<string>();
  for (const round of rounds) {
    if (round.sequence <= sequence) continue;
    for (const id of round.applicationIds) locked.add(id);
  }
  return locked;
}

/**
 * Attendance may only be marked by a coordinator, and only for a student who
 * was actually scheduled.
 *
 * Q9: round 1's participants are the recruiter's choice from the exported
 * applicant list. A student who applied but was never called must never be
 * markable - otherwise they could accrue an absence (R8) for a round they were
 * never invited to, and three of those trigger a disbarment review.
 */
export function canMarkAttendance(role: AppRole, isScheduled: boolean): Permission {
  if (!OPERATORS.includes(role)) {
    return { allowed: false, reason: "Only a placement coordinator may mark attendance." };
  }
  if (!isScheduled) {
    return {
      allowed: false,
      reason: "This student was not scheduled for this round, so attendance cannot be marked.",
    };
  }
  return { allowed: true };
}

/**
 * Results are the Central CPC's to record, and only for someone who took part.
 * Recording a result for an unscheduled student would silently enrol them.
 */
export function canRecordResult(role: AppRole, isScheduled: boolean): Permission {
  if (role !== "central_placement_coordinator") {
    return {
      allowed: false,
      reason: "Only the Central Placement Coordinator may record round results.",
    };
  }
  if (!isScheduled) {
    return {
      allowed: false,
      reason: "This student did not take part in this round.",
    };
  }
  return { allowed: true };
}
