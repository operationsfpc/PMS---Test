import type { SrfStatus } from "./types";

export type SrfDecision =
  | { readonly decision: "approve" }
  | { readonly decision: "reject"; readonly reason: string };

export type SrfDecisionResult =
  | { readonly ok: true; readonly next: SrfStatus }
  | { readonly ok: false; readonly error: string };

/**
 * The CPC's verification decision (PRD §4.2).
 *
 * Approval is what unlocks every drive a student can see (R5), so the guard
 * lives here rather than in the queue component - the same rule is enforced
 * again by the database, and both call this.
 *
 * ⚠️ ASSUMPTION — UNCONFIRMED (A1, authorised 2026-08-02): rejection is not
 * terminal. The student fixes their form, resubmits, and is decided again.
 * This differs deliberately from a rejected PIF, which is permanent.
 */
export function decideSrf(current: SrfStatus, decision: SrfDecision): SrfDecisionResult {
  if (current !== "srf_submitted") {
    return {
      ok: false,
      error: "Only a submitted registration form can be verified.",
    };
  }

  if (decision.decision === "reject" && decision.reason.trim() === "") {
    return {
      ok: false,
      error: "A rejection needs a reason, so the student knows what to correct.",
    };
  }

  return { ok: true, next: decision.decision === "approve" ? "srf_approved" : "srf_rejected" };
}
