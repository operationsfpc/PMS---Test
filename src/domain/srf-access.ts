import type { EditableField } from "./field-editability";
import type { SrfStatus } from "./types";

/**
 * What a student may do with their own registration form.
 *
 * Reworked 2026-08-05. The form used to be editable at every status, which is
 * not a cosmetic problem: PRD §7.2 requires eligibility to be evaluated
 * against VERIFIED data, so a student editing an approved record silently
 * invalidates every shortlist it has already been judged for. Nothing re-runs,
 * and nobody is told.
 *
 * So the form has three lives, and this decides which one it is in:
 *
 *   not sent yet  -> fill it in
 *   submitted     -> read-only, being checked; it must not move underneath
 *                    the coordinator comparing it to a marksheet
 *   sent back     -> editable again, because correcting it IS the next step
 *   approved      -> read-only, with a way through to the parts that are
 *                    still the student's own
 */
export interface SrfAccess {
  readonly mode: "edit" | "view";
  /** What the student is told the form is doing right now. */
  readonly headline: string;
  readonly detail: string;
  /**
   * Whether to offer a way through to editing. Only ever true on a form that
   * is NOT already editable - otherwise it is a link to where you already are.
   */
  readonly canEdit: boolean;
  /** What that link may change. Empty unless `canEdit`. */
  readonly editableFields: readonly EditableField[];
}

/**
 * What an approved student may still change without a coordinator.
 *
 * R10, and deliberately narrow: their marks, arrears and semester record have
 * been checked against documents and are the coordinator's now. Skills,
 * projects and links go stale and are nobody else's business to maintain.
 */
const STILL_THEIRS: readonly EditableField[] = [
  "technical_skills",
  "areas_of_interest",
  "areas_of_expertise",
  "projects",
  "certifications",
  "achievements",
  "resumes",
  "professional_links",
];

export function srfAccess(status: SrfStatus): SrfAccess {
  switch (status) {
    case "srf_submitted":
      return {
        mode: "view",
        headline: "Awaiting verification",
        detail:
          "Your Campus Placement Coordinator is checking your entries against your marksheets. You cannot make changes while it is being checked.",
        canEdit: false,
        editableFields: [],
      };

    case "srf_approved":
      return {
        mode: "view",
        headline: "Verified",
        detail:
          "Your coordinator has verified this against your marksheets. Your academic record is now theirs to correct — ask them if anything is wrong.",
        canEdit: true,
        editableFields: STILL_THEIRS,
      };

    case "srf_rejected":
      return {
        mode: "edit",
        headline: "Sent back for changes",
        detail: "Correct what your coordinator has asked for and submit it again.",
        canEdit: false,
        editableFields: [],
      };

    // Invited but never started, or started and not yet sent. Both are simply
    // an unfinished form.
    default:
      return {
        mode: "edit",
        headline: "Not submitted yet",
        detail: "Complete every section and submit it for verification.",
        canEdit: false,
        editableFields: [],
      };
  }
}
