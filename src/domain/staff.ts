import type { AppRole } from "./types";

export type InvitePermission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Who may invite whom.
 *
 * Confirmed 2026-08-02: an Admin may invite ANY role, including another Admin.
 * Nobody else may invite at all - the invitation row IS the login allowlist,
 * so the power to write one is the power to create an account.
 *
 * `student` is never invitable: students arrive by roster import and claim a
 * pre-loaded record. An invited "student" would have no campus, no degree and
 * no roll number, and so could never be eligible for anything.
 */
export function canInviteRole(actor: AppRole, target: AppRole): InvitePermission {
  if (actor !== "admin") {
    return { allowed: false, reason: "Only an Admin may invite staff." };
  }
  if (target === "student") {
    return {
      allowed: false,
      reason: "Students join through a campus roster import, not an invitation.",
    };
  }
  return { allowed: true };
}

/** Roles scoped to specific campuses, which therefore need at least one. */
const CAMPUS_SCOPED: readonly AppRole[] = [
  "campus_placement_coordinator",
  "campus_manager",
  "key_account_manager",
];

export function requiresCampusAssignment(role: AppRole): boolean {
  return CAMPUS_SCOPED.includes(role);
}
