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

/** How many campuses a role may be mapped to. */
export type CampusScope = "none" | "one" | "many";

/**
 * A Campus Placement Coordinator belongs to ONE campus (confirmed 2026-08-05).
 *
 * This mapping is not a label. It is where a coordinator's authority comes
 * from: `my_student_ids()` reads it to decide whose marksheets they may verify
 * and whose registration they may approve. A second campus silently widens
 * that authority; none removes it altogether, which is how production ended up
 * with a coordinator who could see no students and no way to be told why.
 *
 * Campus Managers and Key Account Managers genuinely span campuses, so they
 * keep the list.
 */
export function campusScopeFor(role: AppRole): CampusScope {
  if (role === "campus_placement_coordinator") return "one";
  return CAMPUS_SCOPED.includes(role) ? "many" : "none";
}

export type CampusSelection =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** Checks a campus mapping before it is written, whatever wrote it. */
export function validateCampusSelection(
  role: AppRole,
  campusIds: readonly string[],
): CampusSelection {
  const scope = campusScopeFor(role);

  if (scope === "none") return { ok: true };

  if (scope === "one" && campusIds.length !== 1) {
    return {
      ok: false,
      error: "A placement coordinator works with one campus. Select exactly one.",
    };
  }

  if (campusIds.length === 0) {
    return { ok: false, error: "Select at least one campus for this role." };
  }

  return { ok: true };
}
