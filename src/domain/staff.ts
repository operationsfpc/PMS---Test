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

export interface StaffMemberRef {
  readonly email: string;
  readonly role: AppRole;
}

export interface StaffChangeContext {
  readonly actor: { readonly role: AppRole; readonly email: string };
  readonly target: StaffMemberRef;
  /** True when removing or demoting the target would leave no active Admin. */
  readonly targetIsLastAdmin: boolean;
}

const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Guards shared by both destructive staff operations.
 *
 * The two failure modes that matter are the same for each: an Admin acting on
 * themselves, and the organisation being left with no Admin at all. Neither is
 * recoverable from inside the application - the second needs database access.
 */
function guardStaffMutation(
  ctx: StaffChangeContext,
  selfReason: string,
  lastAdminReason: string,
): InvitePermission | null {
  if (ctx.actor.role !== "admin") {
    return { allowed: false, reason: "Only an Admin may manage staff." };
  }
  if (samePerson(ctx.actor.email, ctx.target.email)) {
    return { allowed: false, reason: selfReason };
  }
  if (ctx.targetIsLastAdmin) {
    return { allowed: false, reason: lastAdminReason };
  }
  return null;
}

/**
 * Whether an Admin may move someone to a different role.
 *
 * Promoting the last Admin to Admin again is a no-op, not a lockout, so it is
 * allowed - refusing it would make the screen lie about why.
 */
export function canChangeStaffRole(ctx: StaffChangeContext, newRole: AppRole): InvitePermission {
  if (ctx.actor.role !== "admin") {
    return { allowed: false, reason: "Only an Admin may manage staff." };
  }

  if (newRole === "student") {
    return {
      allowed: false,
      reason: "Students join through a campus roster import, not a staff role.",
    };
  }

  // Leaving the last Admin as an Admin changes nothing, so it is not a lockout.
  if (ctx.targetIsLastAdmin && newRole === "admin") {
    return { allowed: true };
  }

  return (
    guardStaffMutation(
      ctx,
      "You cannot change your own role. Ask another Admin.",
      "This is the last Admin. Promote someone else to Admin first.",
    ) ?? { allowed: true }
  );
}

/**
 * Whether an Admin may remove a staff member outright.
 *
 * Removal revokes the invitation, which IS the login allowlist entry, so it
 * ends their access. It does not erase what they did: audit rows and the
 * records they created keep their attribution, and the database refuses the
 * removal if it would orphan any of it.
 */
export function canRemoveStaff(ctx: StaffChangeContext): InvitePermission {
  return (
    guardStaffMutation(
      ctx,
      "You cannot remove your own account. Ask another Admin.",
      "This is the last Admin. Promote someone else to Admin first.",
    ) ?? { allowed: true }
  );
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
