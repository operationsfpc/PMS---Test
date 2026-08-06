import type { ParticipationStatus } from "@domain/types";

/**
 * What the student's two participation screens read and write.
 *
 * One contract, two screens (F2, UAT 2026-08-06): opting out and recording an
 * off-campus offer are unrelated decisions and are now separate heads in the
 * sidebar, but they read the same row and the same request history, so
 * splitting the DATA as well would mean two round trips saying the same thing.
 */

/** Every request keeps its outcome, so the student can come back to it (F3). */
export type RequestStatus = "pending" | "verified" | "rejected";

export interface OptOutRequestView {
  readonly id: string;
  readonly reason: string;
  readonly submittedAt: string;
  readonly status: RequestStatus;
  /** The coordinator's words on a decline (F1). Null when approved or waiting. */
  readonly decisionReason: string | null;
}

export interface SelfPlacementView {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcLpa: number;
  readonly submittedAt: string;
  readonly status: RequestStatus;
  readonly decisionReason: string | null;
}

export interface ParticipationStatusView {
  readonly participationStatus: ParticipationStatus;
  /**
   * Every opt-out request the student has ever raised, newest first — not just
   * the undecided one. F3: "the student is not able to go back to check the
   * submission and approval status of it. It should be shown."
   */
  readonly optOutRequests: readonly OptOutRequestView[];
  readonly selfPlacements: readonly SelfPlacementView[];
}

export interface NewSelfPlacement {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly ctcLpa: number;
  /** Mandatory (UAT 2026-08-05): the coordinator has to verify it. */
  readonly offerLetter: File;
}

export interface NewOptOut {
  readonly reason: string;
  /** Mandatory (UAT 2026-08-05): handwritten, signed, and irreversible. */
  readonly declaration: File;
}

export interface ParticipationView {
  status(): Promise<ParticipationStatusView>;
  requestOptOut(request: NewOptOut): Promise<void>;
  recordSelfPlacement(placement: NewSelfPlacement): Promise<void>;
}

/** A request nobody has decided yet blocks a second one. */
export const hasPendingRequest = (requests: readonly { status: RequestStatus }[]): boolean =>
  requests.some((r) => r.status === "pending");
