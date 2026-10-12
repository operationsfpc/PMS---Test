import {
  canApproveDrive,
  canPublishDrive,
  canRaiseDrive,
  canShortlistFromPortfolio,
} from "./drive-portfolio";
import type { AppRole } from "./types";

/**
 * Who may see drive progress at /cpc/drives.
 *
 * The sidebar shows "Drive progress" for eight roles (2026-10-12). The route
 * guard used to block seven of them — a mismatch that made the link lie.
 *
 * Every role that sees students moving through rounds needs this view: the
 * campus CPC runs it, the central CPC coordinates it, the Delivery Head
 * oversees it, the AE watches their own drives' candidates, and the account
 * managers and leadership see organisational progress.
 */
const DRIVE_PROGRESS_ROLES: readonly AppRole[] = [
  "campus_placement_coordinator",
  "central_placement_coordinator",
  "delivery_head",
  "account_executive",
  "campus_manager",
  "key_account_manager",
  "enterprise_relations",
  "er_head",
  "ceo",
];

export function canViewDriveProgress(role: AppRole): boolean {
  return DRIVE_PROGRESS_ROLES.includes(role);
}

/**
 * Who may access /central/* routes: the central coordination area.
 *
 * Admin is included — they set up the organisation and must be able to see
 * what they built. The sidebar for admin did not surface these links
 * (2026-10-12), so the routes were reachable only by bookmark.
 */
export function canAccessCentral(role: AppRole): boolean {
  return role === "central_placement_coordinator" || role === "admin";
}

/** Who may access /admin/* routes: organisation setup. */
export function canAccessAdmin(role: AppRole): boolean {
  return role === "admin";
}

/** Who may access /cpc/verification, /cpc/certificates, /cpc/semesters, /cpc/attendance. */
export function canAccessCampusCpc(role: AppRole): boolean {
  return role === "campus_placement_coordinator";
}

export function canAccessShortlisting(role: AppRole): boolean {
  return canShortlistFromPortfolio(role);
}

export function canAccessPifCreation(role: AppRole): boolean {
  return canRaiseDrive(role);
}

export function canAccessPifApproval(role: AppRole): boolean {
  return canApproveDrive(role);
}

export function canAccessPublish(role: AppRole): boolean {
  return canPublishDrive(role);
}
