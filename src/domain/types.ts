/**
 * Shared domain vocabulary. Mirrored by Postgres enums in Layer 2.
 * Never use a magic string for any of these outside this module.
 */

/** FINAL list — supersedes both the PRD and the PIF sample. */
export const ROLE_CATEGORIES = [
  "software_technical",
  "technical_support_it_ops",
  "digital_marketing",
  "sales",
  "operations_business",
] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

export const DRIVE_TYPES = ["placement", "internship_convertible", "internship"] as const;
export type DriveType = (typeof DRIVE_TYPES)[number];

/** "Off-campus" is deliberately absent — it means *self-placed* (PRD §16.2). */
export const DRIVE_MODES = ["on_campus", "physical_outside_campus", "virtual", "pooled"] as const;
export type DriveMode = (typeof DRIVE_MODES)[number];

/** `no_history` is the strictest: it implies no standing arrears either. */
export const ARREAR_POLICIES = ["no_standing", "no_history", "flexible"] as const;
export type ArrearPolicy = (typeof ARREAR_POLICIES)[number];

export const SRF_STATUSES = [
  "invited",
  "registered",
  "srf_submitted",
  "srf_approved",
  "srf_rejected",
] as const;
export type SrfStatus = (typeof SRF_STATUSES)[number];

export const PARTICIPATION_STATUSES = ["active", "opted_out", "disbarred"] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const DRIVE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "live",
  "applications_closed",
  "in_rounds",
  "completed",
  "rejected",
] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

export const ROUND_RESULTS = ["selected", "rejected", "waitlisted", "on_hold"] as const;
export type RoundResult = (typeof ROUND_RESULTS)[number];

/** `provisional` = QR self check-in, not yet confirmed by a coordinator. */
export const ATTENDANCE_STATUSES = ["scheduled", "present", "absent", "provisional"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Self-placed offers never touch the ladder or the internship cap (PRD §16.2). */
export const OFFER_SOURCES = ["on_campus", "self_placed"] as const;
export type OfferSource = (typeof OFFER_SOURCES)[number];

/**
 * Every user role in the system. Order mirrors the Postgres `app_role` enum;
 * `src/db/types-drift.test.ts` fails if the two ever diverge.
 */
export const APP_ROLES = [
  "admin",
  "student",
  "campus_placement_coordinator",
  "campus_manager",
  "account_executive",
  "delivery_head",
  "central_placement_coordinator",
  "key_account_manager",
  "enterprise_relations",
  "er_head",
  "ceo",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Verified academic data. The only data eligibility may be evaluated against. */
export interface AcademicProfile {
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly overallCgpa: number;
  readonly tenthPercentage: number;
  readonly twelfthPercentage: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly city: string;
  readonly campus: string;
}
