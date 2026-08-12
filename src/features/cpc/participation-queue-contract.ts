/**
 * What the coordinator's two approval screens read and write.
 *
 * Split into two screens by F2 (UAT 2026-08-06) but backed by one view: both
 * queues are read in the same round trip, and both decisions are the same
 * authority (`canApproveParticipationChange`).
 */

export interface PendingOptOut {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly reason: string;
  /** Short-lived signed URL for the student's signed declaration (PRD §21.2). */
  readonly declarationUrl: string | null;
}

export interface PendingSelfPlacement {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly companyName: string;
  readonly ctcLpa: number;
  /** Short-lived signed URL for the offer letter (PRD §21.2). */
  readonly offerLetterUrl: string | null;
}

export interface PendingParticipation {
  readonly optOuts: readonly PendingOptOut[];
  readonly selfPlacements: readonly PendingSelfPlacement[];
}

/**
 * D5/D6 (2026-08-12): an approved self-placed offer climbs the category
 * ladder and a self-placed internship consumes the internship cap, so the
 * approving coordinator must classify what they are approving. A job needs
 * its rung; an internship is never classified.
 */
export interface SelfPlacementClassification {
  readonly driveType: "placement" | "internship";
  readonly offerCategory: "regular" | "dream" | "super_dream" | null;
}

export interface ParticipationQueueView {
  pending(): Promise<PendingParticipation>;
  approveOptOut(requestId: string): Promise<void>;
  /** F1: the reason is required, and it is what the student is shown. */
  declineOptOut(requestId: string, reason: string): Promise<void>;
  approveSelfPlacement(offerId: string, classification: SelfPlacementClassification): Promise<void>;
  declineSelfPlacement(offerId: string, reason: string): Promise<void>;
}
