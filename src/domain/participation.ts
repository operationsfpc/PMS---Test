import type { AppRole, ParticipationStatus } from "./types";

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface OptOutContext {
  readonly participationStatus: ParticipationStatus;
  readonly hasPendingRequest: boolean;
  /**
   * A handwritten, signed declaration confirming the decision (UAT
   * 2026-08-05). Required because approval is irreversible: once granted,
   * 0009 refuses to move the student back, so "I never asked to opt out" has
   * to be answerable with a document.
   */
  readonly hasDeclaration: boolean;
}

/**
 * The reason is a note a coordinator reads in a queue, not a document. Without
 * a bound one pasted block runs for screens and buries every row after it.
 */
export const MAX_OPT_OUT_REASON = 1000;

/**
 * Whether the words the student typed can be sent at all.
 *
 * The screen and the view ask this so an over-long reason is refused with the
 * same sentence before anything is uploaded or written.
 */
export function optOutReasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return "Give a reason for opting out.";
  }
  if (trimmed.length > MAX_OPT_OUT_REASON) {
    return "Keep your reason to 1,000 characters or fewer.";
  }
  return null;
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
  /**
   * Releasing a hold writes `active` back, while opting out is irreversible
   * (0009) — so a held student could end their placements to escape the hold,
   * leaving the college no release to grant.
   */
  if (context.participationStatus === "on_hold") {
    return {
      allowed: false,
      reason:
        "Your college has placed a hold on your placements. Ask them to release it before opting out.",
    };
  }
  if (context.hasPendingRequest) {
    return { allowed: false, reason: "Your opt-out request is already waiting for approval." };
  }
  // Asked LAST of the refusals: a student who has already opted out should be
  // told that, not asked for a document they no longer need.
  if (!context.hasDeclaration) {
    return {
      allowed: false,
      reason:
        "Upload a handwritten declaration, signed by you, confirming that you are opting out.",
    };
  }
  return { allowed: true };
}

/**
 * Recording an off-campus offer the student found themselves.
 *
 * Deliberately still open to an opted-out student: opting out is usually
 * BECAUSE they took an outside job, and the placement statistics need that
 * offer recorded. A held student keeps it too — a `self_placed` hold is placed
 * BECAUSE they found a job, so refusing the letter would hide the one fact the
 * hold was raised over. It never touches the ladder or the cap (PRD 16.2).
 */
export function canRecordSelfPlacement(context: {
  readonly participationStatus: ParticipationStatus;
  /**
   * The offer letter (A18, and UAT 2026-08-05). There is no drive to
   * corroborate an off-campus offer, and it becomes a number the college
   * reports, so the letter is the only evidence a coordinator can verify.
   */
  readonly hasOfferLetter: boolean;
}): Decision {
  if (context.participationStatus === "disbarred") {
    return {
      allowed: false,
      reason: "A disbarred student cannot record an offer. Speak to your placement coordinator.",
    };
  }
  if (!context.hasOfferLetter) {
    return {
      allowed: false,
      reason: "Upload your offer letter. Your coordinator has to verify it before it counts.",
    };
  }
  return { allowed: true };
}

/**
 * Asking the Campus Manager for a self-placed hold (0130).
 *
 * Student-filed, manager-confirmed. Two documents are required — the offer
 * letter and a handwritten, signed declaration — because the manager closes the
 * student's drives on the strength of this request alone. Nothing is closed
 * until that confirmation: an unconfirmed row is just a request.
 */
export function canRequestSelfPlacedHold(context: {
  readonly participationStatus: ParticipationStatus;
  readonly hasOfferLetter: boolean;
  readonly hasDeclaration: boolean;
}): Decision {
  if (context.participationStatus === "disbarred") {
    return {
      allowed: false,
      reason: "A disbarred student cannot request a hold. Speak to your placement coordinator.",
    };
  }
  if (context.participationStatus === "opted_out") {
    return {
      allowed: false,
      reason: "You have already opted out, so there are no drives left to hold.",
    };
  }
  if (context.participationStatus === "on_hold") {
    return {
      allowed: false,
      reason: "Your placements are already on hold. Your Campus Manager releases it.",
    };
  }
  if (!context.hasOfferLetter) {
    return {
      allowed: false,
      reason: "Upload your offer letter. Your Campus Manager reads it before confirming the hold.",
    };
  }
  // Asked last of the ones about documents: it is the second one they need.
  if (!context.hasDeclaration) {
    return {
      allowed: false,
      reason:
        "Upload a handwritten declaration, signed by you, confirming that you have taken this offer.",
    };
  }
  return { allowed: true };
}

/** The two roles that decide either request. Approving and declining are one authority. */
const APPROVERS: readonly AppRole[] = [
  "campus_placement_coordinator",
  "central_placement_coordinator",
];

/** Both opt-out and self-placement are approved by a coordinator, never the student. */
export function canApproveParticipationChange(actor: AppRole): Decision {
  if (!APPROVERS.includes(actor)) {
    return { allowed: false, reason: "Only a placement coordinator may approve this." };
  }
  return { allowed: true };
}

/**
 * Shorter than this is not an explanation ("no", "na", "-"). Deliberately low:
 * the bar is "a sentence fragment a student can act on", not an essay.
 */
const MIN_DECLINE_REASON = 5;

/**
 * Declining an opt-out or an off-campus offer. F1 (UAT 2026-08-06).
 *
 * The reason is REQUIRED because it is the only thing the student is told. A
 * blank decline is indistinguishable, from their side, from the request never
 * having been looked at — and the request cost them a scanned letter.
 */
export function canDeclineParticipationRequest(actor: AppRole, reason: string): Decision {
  if (!APPROVERS.includes(actor)) {
    return { allowed: false, reason: "Only a placement coordinator may decline this." };
  }
  if (reason.trim().length < MIN_DECLINE_REASON) {
    return {
      allowed: false,
      reason: "Give a reason for declining. The student is shown it, and it is all they get.",
    };
  }
  return { allowed: true };
}

/** How a decided request reads on the student's own screen. */
export type ParticipationOutcomeTone = "waiting" | "approved" | "declined";

export interface ParticipationOutcome {
  readonly tone: ParticipationOutcomeTone;
  readonly label: string;
  /** The coordinator's words on a decline; null when there is nothing to add. */
  readonly detail: string | null;
}

/**
 * What the student sees after they have asked. F3 (UAT 2026-08-06).
 *
 * The screen used to drop the request the moment it was decided, so a student
 * who uploaded an offer letter could never confirm it had been accepted. The
 * submission and its outcome both stay.
 */
export function participationOutcome(request: {
  readonly status: "pending" | "verified" | "rejected";
  readonly reason: string | null;
}): ParticipationOutcome {
  if (request.status === "pending") {
    return {
      tone: "waiting",
      label: "Waiting for your placement coordinator",
      detail: null,
    };
  }

  if (request.status === "verified") {
    return { tone: "approved", label: "Approved", detail: null };
  }

  const reason = (request.reason ?? "").trim();
  return {
    tone: "declined",
    label: "Declined",
    // Never blank: silence here reads as "no reason was needed".
    detail: reason === "" ? "No reason was recorded. Ask your placement coordinator." : reason,
  };
}
