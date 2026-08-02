import type { AppRole, ParticipationStatus } from "./types";

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface OptOutContext {
  readonly participationStatus: ParticipationStatus;
  readonly hasPendingRequest: boolean;
}

/**
 * Opting out.
 *
 * Student-initiated ONLY. Nothing about a student's marks, arrears or absences
 * may ever trigger this - it is a choice, and the system must not make it for
 * them. Approval is the coordinator's, and it is irreversible once given.
 */
export function canRequestOptOut(context: OptOutContext): Decision {
  if (context.participationStatus === "opted_out") {
    return { allowed: false, reason: "You have already opted out. This cannot be reversed." };
  }
  if (context.participationStatus === "disbarred") {
    return {
      allowed: false,
      reason: "A disbarred student cannot opt out. Speak to your placement coordinator.",
    };
  }
  if (context.hasPendingRequest) {
    return { allowed: false, reason: "Your opt-out request is already waiting for approval." };
  }
  return { allowed: true };
}

/**
 * Recording an off-campus offer the student found themselves.
 *
 * Deliberately still open to an opted-out student: opting out is usually
 * BECAUSE they took an outside job, and the placement statistics need that
 * offer recorded. It never touches the ladder or the cap (PRD 16.2).
 */
export function canRecordSelfPlacement(context: {
  readonly participationStatus: ParticipationStatus;
}): Decision {
  if (context.participationStatus === "disbarred") {
    return {
      allowed: false,
      reason: "A disbarred student cannot record an offer. Speak to your placement coordinator.",
    };
  }
  return { allowed: true };
}

/** Both opt-out and self-placement are approved by a coordinator, never the student. */
export function canApproveParticipationChange(actor: AppRole): Decision {
  const approvers: readonly AppRole[] = [
    "campus_placement_coordinator",
    "central_placement_coordinator",
  ];
  if (!approvers.includes(actor)) {
    return { allowed: false, reason: "Only a placement coordinator may approve this." };
  }
  return { allowed: true };
}
