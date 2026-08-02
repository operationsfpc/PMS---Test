import { canInviteRole } from "@domain/staff";
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
  /** Deactivation, never deletion: audit rows reference these people. */
  setActive(email: string, isActive: boolean): Promise<void>;
}

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
  getActorRole: () => Promise<AppRole>,
): StaffRepository {
  return {
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
      const permission = canInviteRole(await getActorRole(), invitation.role);
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
  };
}
