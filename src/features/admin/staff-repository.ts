import {
  canChangeStaffRole,
  canInviteRole,
  canRemoveStaff,
  type StaffChangeContext,
} from "@domain/staff";
import type { AppRole } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class StaffError extends Error {}

export interface StaffMember {
  readonly email: string;
  readonly fullName: string;
  readonly role: AppRole;
  /** Null until they first sign in - the invitation is still outstanding. */
  readonly acceptedAt: string | null;
  readonly isActive: boolean;
}

export interface CampusOption {
  readonly id: string;
  readonly name: string;
}

export interface NewInvitation {
  readonly fullName: string;
  readonly email: string;
  readonly role: AppRole;
  readonly campusIds: readonly string[];
}

export interface StaffRepository {
  list(): Promise<readonly StaffMember[]>;
  campuses(): Promise<readonly CampusOption[]>;
  invite(invitation: NewInvitation): Promise<void>;
  /** Reversible. The account survives, and so does everything it did. */
  setActive(email: string, isActive: boolean): Promise<void>;
  /** Moves someone to a different role, invitation and profile together. */
  changeRole(email: string, newRole: AppRole): Promise<void>;
  /** Revokes the login outright. Refused when their work is still referenced. */
  remove(email: string): Promise<void>;
}

/** Who is asking. Both destructive operations need the email, not just the role. */
export type GetActor = () => Promise<{ role: AppRole; email: string }>;

/**
 * Staff invitations.
 *
 * An invitation row IS the login allowlist entry (migration 0009): on first
 * Google sign-in a trigger materialises the profile with the invited role. So
 * this repository is an account-creation surface, and the domain decides who
 * may use it.
 */
export function createSupabaseStaffRepository(
  client: SupabaseClient,
  getActor: GetActor,
): StaffRepository {
  /**
   * Builds the decision context the domain needs.
   *
   * `targetIsLastAdmin` counts only ACTIVE Admins: a deactivated one cannot
   * sign in, so treating them as cover would let the organisation demote its
   * way into having no usable Admin at all.
   */
  async function contextFor(email: string): Promise<StaffChangeContext> {
    const [actor, staff] = await Promise.all([getActor(), repository.list()]);
    const target = staff.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());

    if (target === undefined) throw new StaffError("That staff member no longer exists.");

    const activeAdmins = staff.filter((m) => m.role === "admin" && m.isActive);

    return {
      actor,
      target: { email: target.email, role: target.role },
      targetIsLastAdmin: target.role === "admin" && target.isActive && activeAdmins.length <= 1,
    };
  }

  const repository: StaffRepository = {
    async list() {
      const [{ data: invitations, error }, { data: profiles }] = await Promise.all([
        client.from("staff_invitations").select("email, full_name, role, accepted_at"),
        client.from("profiles").select("email, is_active"),
      ]);

      if (error !== null) throw new StaffError("Could not load the staff list.");

      const activeByEmail = new Map(
        (profiles ?? []).map((p) => [String(p.email).toLowerCase(), p.is_active as boolean]),
      );

      return (invitations ?? [])
        .map(
          (row): StaffMember => ({
            email: row.email as string,
            fullName: row.full_name as string,
            role: row.role as AppRole,
            acceptedAt: (row.accepted_at as string | null) ?? null,
            // Someone who has never signed in has no profile row yet, and is
            // therefore still "active" in the sense that matters: invited.
            isActive: activeByEmail.get(String(row.email).toLowerCase()) ?? true,
          }),
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    },

    async campuses() {
      const { data, error } = await client
        .from("campuses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (error !== null) throw new StaffError("Could not load the campuses.");
      return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
    },

    async invite(invitation) {
      const permission = canInviteRole((await getActor()).role, invitation.role);
      if (!permission.allowed) throw new StaffError(permission.reason);

      const { error } = await client
        .from("staff_invitations")
        .insert({
          email: invitation.email.trim().toLowerCase(),
          full_name: invitation.fullName.trim(),
          role: invitation.role,
        })
        .select("email")
        .single();

      if (error !== null) {
        throw new StaffError(
          error.code === "23505"
            ? "That email has already been invited."
            : "Could not send the invitation. Please try again.",
        );
      }

      if (invitation.campusIds.length === 0) return;

      // The profile does not exist until first sign-in, so the assignment is
      // staged against the invited email and applied when they arrive.
      const { error: assignmentError } = await client
        .from("staff_campus_invitations")
        .insert(
          invitation.campusIds.map((campusId) => ({
            email: invitation.email.trim().toLowerCase(),
            campus_id: campusId,
          })),
        )
        .select("campus_id");

      if (assignmentError !== null) {
        throw new StaffError(
          "The invitation was sent, but the campus assignment failed. Please set it again.",
        );
      }
    },

    async setActive(email, isActive) {
      const { error } = await client
        .from("profiles")
        .update({ is_active: isActive })
        .eq("email", email)
        .select("email");

      if (error !== null) throw new StaffError("Could not update that staff member.");
    },

    async changeRole(email, newRole) {
      const permission = canChangeStaffRole(await contextFor(email), newRole);
      if (!permission.allowed) throw new StaffError(permission.reason);

      const target = email.trim().toLowerCase();

      // The invitation carries the role materialised on first sign-in, so it
      // has to move too - otherwise anyone who has not signed in yet arrives
      // with the old role and nobody can see why.
      const { error: inviteError } = await client
        .from("staff_invitations")
        .update({ role: newRole })
        .eq("email", target)
        .select("email");

      if (inviteError !== null) {
        throw new StaffError("Could not change that role. Please try again.");
      }

      // No profile exists until first sign-in; updating nothing is correct then.
      const { error: profileError } = await client
        .from("profiles")
        .update({ role: newRole })
        .eq("email", target)
        .select("email");

      if (profileError !== null) {
        throw new StaffError(
          "The invitation was updated, but their signed-in role was not. Please try again.",
        );
      }
    },

    async remove(email) {
      const permission = canRemoveStaff(await contextFor(email));
      if (!permission.allowed) throw new StaffError(permission.reason);

      const target = email.trim().toLowerCase();

      // Order matters: revoke the login first, so a failure part-way through
      // leaves an account that cannot be used rather than one that can.
      for (const table of ["staff_invitations", "staff_campus_invitations"]) {
        const { error } = await client.from(table).delete().eq("email", target);
        if (error !== null) throw new StaffError("Could not remove that staff member.");
      }

      const { error } = await client.from("profiles").delete().eq("email", target);

      if (error !== null) {
        // PRD 19 keeps attribution: Postgres refuses to orphan the drives,
        // offers and results this person is named on. Retrying cannot help.
        throw new StaffError(
          error.code === "23503"
            ? "Their login has been revoked, but their record cannot be deleted because drives or results are still attributed to them. Deactivate them instead."
            : "Could not remove that staff member.",
        );
      }
    },
  };

  return repository;
}
