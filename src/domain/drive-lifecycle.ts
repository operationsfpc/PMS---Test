import type { OfferCategory } from "./offer-category";
import type { DriveStatus, DriveType, RoleCategory } from "./types";

/**
 * Everything §3.5 requires before a drive may go live.
 *
 * Deliberately a flat, primitive shape: the form, the approval queue and the
 * publish screen all describe the same drive differently, and this rule must
 * not depend on any of their representations.
 */
export interface DriveReadiness {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly roleCategory: RoleCategory | null;
  readonly jobDescription: string;
  /**
   * J1 (2026-08-18): the recruiter's own JD PDF, attached at the PIF. It is
   * the document of record; the typed text is an optional, phone-readable
   * summary. Either satisfies §3.5 — refusing a drive whose JD arrived as an
   * attachment would demand a retype of a document already on file.
   */
  readonly hasJobDescriptionFile: boolean;
  readonly locations: readonly string[];
  readonly ctcMinLpa: number | null;
  readonly driveType: DriveType | null;
  readonly offerCategory: OfferCategory | null;
  readonly hasEligibilityCriteria: boolean;
  readonly roundCount: number;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  readonly onHold: boolean;
}

export type PifDecision =
  | { readonly decision: "approve"; readonly offerCategory: OfferCategory | null }
  | { readonly decision: "reject"; readonly reason: string };

export type PifDecisionResult =
  | { readonly ok: true; readonly next: DriveStatus }
  | { readonly ok: false; readonly error: string };

export type GoLiveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

const blank = (value: string) => value.trim() === "";

/**
 * Every field §3.5 requires, reported together.
 *
 * Returns *all* omissions rather than the first, because the Central CPC
 * completing a half-finished PIF needs the whole list, not a game of
 * whack-a-mole.
 */
export function missingBeforeGoLive(drive: DriveReadiness): readonly string[] {
  const missing: string[] = [];

  if (blank(drive.companyName)) missing.push("Company name");
  if (blank(drive.roleTitle)) missing.push("Role title");
  if (drive.roleCategory === null) missing.push("Role category");
  if (blank(drive.jobDescription) && !drive.hasJobDescriptionFile) {
    missing.push("Job description");
  }
  if (drive.locations.length === 0) missing.push("At least one location");
  if (drive.ctcMinLpa === null) missing.push("Minimum CTC (LPA)");
  if (drive.driveType === null) missing.push("Drive type");
  if (drive.offerCategory === null) missing.push("Offer category");
  if (!drive.hasEligibilityCriteria) missing.push("Eligibility criteria");
  if (drive.roundCount < 1) missing.push("At least one round");
  if (drive.applicationStart === null) missing.push("Application start");
  if (drive.applicationEnd === null) missing.push("Application end");

  if (
    drive.applicationStart !== null &&
    drive.applicationEnd !== null &&
    drive.applicationEnd <= drive.applicationStart
  ) {
    missing.push("A valid application window (it currently ends before it starts)");
  }

  return missing;
}

/**
 * §3.2: a drive cannot go live while held, however complete it is. On-hold is
 * a flag rather than a status precisely so it composes with the lifecycle
 * instead of multiplying it.
 */
export function canGoLive(status: DriveStatus, drive: DriveReadiness): GoLiveResult {
  const reasons: string[] = [];

  if (status !== "approved") {
    reasons.push("The drive must be approved by the Delivery Head before it can go live.");
  }
  if (drive.onHold) {
    reasons.push("The drive is on hold and cannot be published until the hold is lifted.");
  }
  reasons.push(...missingBeforeGoLive(drive).map((field) => `Missing: ${field}`));

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * The Delivery Head's decision.
 *
 * `offer_category` is set here and nowhere else: §3.3 makes it immutable
 * afterwards, so an approval without one would produce a drive that can never
 * be classified. Rejection is terminal - a rejected PIF is never reopened, and
 * a fresh PIF must be raised instead.
 */
export function decidePif(current: DriveStatus, decision: PifDecision): PifDecisionResult {
  if (current !== "submitted") {
    return { ok: false, error: "Only a submitted PIF can be approved or rejected." };
  }

  if (decision.decision === "approve") {
    if (decision.offerCategory === null) {
      return {
        ok: false,
        error: "An offer category must be set at approval - it cannot be changed later.",
      };
    }
    return { ok: true, next: "approved" };
  }

  if (blank(decision.reason)) {
    return {
      ok: false,
      error: "A rejection needs a reason. A rejected PIF cannot be resubmitted.",
    };
  }

  return { ok: true, next: "rejected" };
}

/**
 * The three lists the Central PC works from (2026-08-18, Karthik).
 *
 * "approved is yet to publish. these should be in yet to publish … we can have
 * a third box, there called completed. This way we have three tabs — approved =
 * yet to publish; published - page name can be live; completed. drafts can be
 * removed."
 *
 * One vocabulary for all three tabs, because a status belonging to no tab is a
 * drive nobody can find and a status in two is a drive counted twice.
 *
 * ⚠️ ASSUMPTION — UNCONFIRMED (A39). `submitted` and `rejected` appear on none
 * of them. That follows from 0047 — raising is the Account Executive's,
 * approving is the Delivery Head's, publishing is the Central CPC's — so a
 * drive neither of the other two has finished with is not this coordinator's to
 * work on. Reversing it is one entry in this object.
 */
export const DRIVE_TAB_STATUSES: Readonly<Record<DriveTab, readonly DriveStatus[]>> = {
  "yet-to-publish": ["approved"],
  live: ["live", "applications_closed", "in_rounds"],
  completed: ["completed"],
};

export type DriveTab = "yet-to-publish" | "live" | "completed";
