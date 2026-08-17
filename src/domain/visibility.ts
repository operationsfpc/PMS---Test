/**
 * R5 / R5a / R6 — Which drives a student may see, and whether they may apply.
 * PRD §7.4, §7.5, §11, §12, §22.
 *
 * This is the most consequential module in the system: it decides who gets an
 * opportunity. Every branch is covered by a named test.
 */

import {
  type EligibilityCriteria,
  type EligibilityFailure,
  evaluateEligibility,
} from "./eligibility";
import { type OfferCategory, offerCategoryRank } from "./offer-category";
import { highestOfferCategory, isInternshipCapConsumed, type Offer } from "./offers";
import type {
  AcademicProfile,
  DriveStatus,
  DriveType,
  ParticipationStatus,
  RoleCategory,
  SrfStatus,
} from "./types";

export interface StudentContext {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  /** Verified data only — eligibility is never evaluated against pending edits. */
  readonly academics: AcademicProfile;
  readonly offers: readonly Offer[];
  /**
   * The areas they asked to be considered for, from their registration form
   * (2026-08-18). Optional because a form submitted before 0049 recorded none -
   * and silence is not refusal, so an empty list matches every drive.
   */
  readonly roleCategories?: readonly RoleCategory[];
}

export interface VisibleDrive {
  readonly id: string;
  readonly status: DriveStatus;
  readonly driveType: DriveType;
  readonly offerCategory: OfferCategory | null;
  /**
   * R5a — the Central CPC's prestige-drive escape hatch. Bypasses the category
   * ladder and the internship cap. Never bypasses consent, sanctions or
   * academic eligibility. Setting it must be audit-logged with a reason.
   */
  readonly openToAllOverride: boolean;
  /**
   * The area this drive is for, declared by the AE on the PIF (2026-08-18):
   * "a drive has to be classified into one of these areas … This should go to
   * the students only showing interest in that area."
   *
   * Null on a drive that declares none - which is every drive raised before the
   * rule. Hiding those from everybody would empty their audience overnight.
   */
  readonly roleCategory?: RoleCategory | null;
  readonly applicationStart: Date;
  readonly applicationEnd: Date;
  readonly criteria: EligibilityCriteria;
}

export type VisibilityReason =
  | "visible"
  | "srf_not_approved"
  | "opted_out"
  | "disbarred"
  | "not_eligible"
  | "area_not_chosen"
  | "internship_cap_consumed"
  | "placed_at_equal_or_higher";

export interface VisibilityResult {
  readonly visible: boolean;
  readonly reason: VisibilityReason;
  readonly failures?: readonly EligibilityFailure[];
}

const LADDER_DRIVE_TYPES: readonly DriveType[] = ["placement", "internship_convertible"];
const INTERNSHIP_DRIVE_TYPES: readonly DriveType[] = ["internship", "internship_convertible"];

/**
 * R5 — is this NEW drive visible to this student?
 *
 * Does not govern drives already applied to: a placed student continues through
 * every round of every in-process drive regardless of category (PRD §12).
 */
export function isDriveVisibleToStudent(
  student: StudentContext,
  drive: VisibleDrive,
): VisibilityResult {
  // --- Gates the CPC override can never bypass -----------------------------
  if (student.srfStatus !== "srf_approved") {
    return { visible: false, reason: "srf_not_approved" };
  }

  if (student.participationStatus === "opted_out") {
    return { visible: false, reason: "opted_out" };
  }

  if (student.participationStatus === "disbarred") {
    return { visible: false, reason: "disbarred" };
  }

  const eligibility = evaluateEligibility(student.academics, drive.criteria);
  if (!eligibility.eligible) {
    return { visible: false, reason: "not_eligible", failures: eligibility.failures };
  }

  // --- Placement-history gates, which the override DOES bypass (R5a) -------
  if (drive.openToAllOverride) {
    return { visible: true, reason: "visible" };
  }

  /**
   * The area the student asked for. A PREFERENCE, not a sanction - which is why
   * it sits below the override with the other preference gates rather than
   * above it with consent and eligibility.
   *
   * Both empty cases mean "no opinion", deliberately: a drive that declares no
   * area predates the rule, and a student who has chosen none has not refused
   * everything, they have not answered.
   */
  if (
    drive.roleCategory !== null &&
    drive.roleCategory !== undefined &&
    student.roleCategories !== undefined &&
    student.roleCategories.length > 0 &&
    !student.roleCategories.includes(drive.roleCategory)
  ) {
    return { visible: false, reason: "area_not_chosen" };
  }

  // The cap is checked before the ladder (decision Q2): a Super Dream
  // internship-convertible drive is still hidden from a capped student.
  if (INTERNSHIP_DRIVE_TYPES.includes(drive.driveType) && isInternshipCapConsumed(student.offers)) {
    return { visible: false, reason: "internship_cap_consumed" };
  }

  if (LADDER_DRIVE_TYPES.includes(drive.driveType)) {
    const highest = highestOfferCategory(student.offers);
    if (highest !== null) {
      const driveCategory = drive.offerCategory;
      const strictlyHigher =
        driveCategory !== null && offerCategoryRank(driveCategory) > offerCategoryRank(highest);
      if (!strictlyHigher) {
        return { visible: false, reason: "placed_at_equal_or_higher" };
      }
    }
  }

  return { visible: true, reason: "visible" };
}

export type ApplyRefusal =
  | Exclude<VisibilityReason, "visible">
  | "drive_not_live"
  | "window_not_open"
  | "window_closed"
  | "already_applied";

export interface ApplyResult {
  readonly allowed: boolean;
  readonly reason: ApplyRefusal | "allowed";
  readonly failures?: readonly EligibilityFailure[];
}

/**
 * R6 — may this student apply right now?
 *
 * `now` is injected so tests control time. There is no withdrawal once applied
 * (PRD §7.4), so this is the only gate that matters.
 */
export function canApply(
  student: StudentContext,
  drive: VisibleDrive,
  now: Date,
  appliedDriveIds: readonly string[] = [],
): ApplyResult {
  const visibility = isDriveVisibleToStudent(student, drive);
  if (!visibility.visible) {
    const result: ApplyResult = {
      allowed: false,
      reason: visibility.reason as ApplyRefusal,
      ...(visibility.failures !== undefined ? { failures: visibility.failures } : {}),
    };
    return result;
  }

  if (drive.status !== "live") {
    return { allowed: false, reason: "drive_not_live" };
  }

  if (now < drive.applicationStart) {
    return { allowed: false, reason: "window_not_open" };
  }

  if (now > drive.applicationEnd) {
    return { allowed: false, reason: "window_closed" };
  }

  if (appliedDriveIds.includes(drive.id)) {
    return { allowed: false, reason: "already_applied" };
  }

  return { allowed: true, reason: "allowed" };
}
