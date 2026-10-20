import { composeStaffInviteEmail } from "@domain/email-delivery";
import {
  canChangeStaffRole,
  canInviteRole,
  canRemoveStaff,
  type StaffChangeContext,
  validateCampusSelection,
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
  /**
   * The campuses they are mapped to. Empty is a real and visible state: a
   * coordinator with no campus can see no students, and until this was shown
   * on the staff screen there was no way to tell that from an empty cohort.
   */
  readonly campuses: readonly CampusOption[];
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
  /**
   * Maps an EXISTING staff member to campuses, replacing what they had.
   *
   * Campuses could previously only be chosen while inviting, so a coordinator
   * invited before that existed - or invited without one - was stuck with no
   * campus and no students, and no way to fix it outside the database.
   */
  setCampuses(email: string, campusIds: readonly string[]): Promise<void>;
  /** Revokes the login outright. Refused when their work is still referenced. */
  remove(email: string): Promise<void>;
  /** Re-queues the staff onboarding invitation email for an unaccepted account. */
  resendInvite?(email: string): Promise<void>;
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

  /**
   * Resolves an email to the profile id the assignment table is keyed by.
   *
   * Null until they first sign in: `staff_campus_assignments` references
   * `profiles(id)`, which does not exist yet, so the mapping has to be staged
   * against the email instead.
   */
  async function profileIdFor(email: string): Promise<string | null> {
    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    /*
     * Null here is an instruction, not a missing value: it sends `setCampuses`
     * to the STAGING table. So a refused read applied a campus mapping to
     * someone who has signed in as a staged row that is never applied — their
     * students stay invisible, with the screen saying the mapping was saved.
     */
    if (error !== null) {
      throw new StaffError(
        "We could not check whether that person has signed in. Please try again.",
      );
    }

    return (data?.id as string | undefined) ?? null;
  }

  const repository: StaffRepository = {
    async list() {
      const [
        { data: invitations, error: invitationsError },
        { data: profiles, error: profilesError },
        campuses,
      ] = await Promise.all([
        client.from("staff_invitations").select("email, full_name, role, accepted_at"),
        client.from("profiles").select("id, email, is_active"),
        repository.campuses(),
      ]);

      if (invitationsError !== null) throw new StaffError("Could not load the staff list.");

      /*
       * `isActive` comes from profiles, and `contextFor` counts ACTIVE Admins
       * before letting one be demoted or removed. A refused profiles read used
       * to fall back to `?? true`, so every deactivated Admin counted as cover
       * — which is how the organisation could be left with no usable Admin.
       */
      if (profilesError !== null) {
        throw new StaffError("We could not read who has signed in. Please try again.");
      }

      const activeByEmail = new Map(
        (profiles ?? []).map((p) => [String(p.email).toLowerCase(), p.is_active as boolean]),
      );
      const emailByProfileId = new Map(
        (profiles ?? []).map((p) => [String(p.id), String(p.email).toLowerCase()]),
      );
      const campusById = new Map(campuses.map((c) => [c.id, c]));

      // Both halves of the mapping: applied for anyone who has signed in,
      // still staged against the email for anyone who has not. Reading only
      // the applied half would show an invited coordinator as having no
      // campus when one is already waiting for them.
      const [{ data: assignments, error: assignmentsError }, { data: staged, error: stagedError }] =
        await Promise.all([
          client.from("staff_campus_assignments").select("profile_id, campus_id"),
          client.from("staff_campus_invitations").select("email, campus_id"),
        ]);

      /*
       * An empty mapping is a real, deliberately visible state on this screen
       * (see StaffMember.campuses) — which is exactly why a refused read may
       * not be allowed to produce one: "no campus" and "we could not tell"
       * must not look alike here.
       */
      if (assignmentsError !== null || stagedError !== null) {
        throw new StaffError("We could not read which campuses staff are mapped to.");
      }

      const campusesByEmail = new Map<string, CampusOption[]>();
      const add = (email: string | undefined, campusId: string) => {
        const campus = campusById.get(campusId);
        if (email === undefined || campus === undefined) return;
        const list = campusesByEmail.get(email) ?? [];
        if (!list.some((c) => c.id === campus.id)) list.push(campus);
        campusesByEmail.set(email, list);
      };

      for (const row of assignments ?? []) {
        add(emailByProfileId.get(String(row.profile_id)), String(row.campus_id));
      }
      for (const row of staged ?? []) {
        add(String(row.email).toLowerCase(), String(row.campus_id));
      }

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
            campuses: campusesByEmail.get(String(row.email).toLowerCase()) ?? [],
          }),
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    },

    async setCampuses(email, campusIds) {
      const actor = await getActor();
      if (actor.role !== "admin") {
        throw new StaffError("Only an Admin may change a campus mapping.");
      }

      const staff = await repository.list();
      const target = staff.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
      if (target === undefined) throw new StaffError("That staff member no longer exists.");

      // The domain owns the rule - one campus for a coordinator, at least one
      // for the others - so this cannot become a way around it.
      const selection = validateCampusSelection(target.role, campusIds);
      if (!selection.ok) throw new StaffError(selection.error);

      const address = email.trim().toLowerCase();
      const profileId = await profileIdFor(address);

      // Atomic replacement: 0098's function deletes and inserts in one
      // transaction, so a failure leaves the old mapping intact rather than
      // empty. Applied where they have signed in, staged where they have not.
      const fn =
        profileId === null ? "set_staff_campus_invitations" : "set_staff_campus_assignments";
      const key = profileId ?? address;

      const { error } = await client.rpc(fn, {
        [profileId === null ? "p_email" : "p_profile_id"]: key,
        p_campus_ids: campusIds,
      });

      if (error !== null) {
        throw new StaffError("Could not change that campus mapping. Please try again.");
      }
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

      const email = invitation.email.trim().toLowerCase();

      // Stage campus assignments first so that if the user already has an
      // auth.users row, the `accept_invitation_for_existing_account` trigger
      // finds their staged campuses immediately.
      if (invitation.campusIds.length > 0) {
        const { error: stagedError } = await client.from("staff_campus_invitations").insert(
          invitation.campusIds.map((campusId) => ({
            email,
            campus_id: campusId,
          })),
        );

        if (stagedError !== null && stagedError.code !== "23505") {
          throw new StaffError(
            "The invitation was sent, but the campus assignment failed. Please set it again.",
          );
        }
      }

      const { error } = await client
        .from("staff_invitations")
        .insert({
          email,
          full_name: invitation.fullName.trim(),
          role: invitation.role,
        })
        .select("email")
        .single();

      if (error !== null) {
        if (invitation.campusIds.length > 0) {
          await client.from("staff_campus_invitations").delete().eq("email", email);
        }

        // 0040 refuses an address already on the student roster, and names it.
        // Reporting that as "already been invited" would be a lie - nobody
        // invited them - and would send an administrator hunting through the
        // staff list for a row that is not there.
        if (error.code === "23505" && /student or staff/i.test(error.message)) {
          throw new StaffError(error.message);
        }

        throw new StaffError(
          error.code === "23505"
            ? "That email has already been invited."
            : "Could not send the invitation. Please try again.",
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

      // Profile first: it is what the live session reads, so a failure here
      // leaves nothing half-changed. The invitation follows because it is the
      // role materialised on first sign-in - anyone who has not signed in yet
      // would otherwise arrive with the old role.
      const { error: profileError } = await client
        .from("profiles")
        .update({ role: newRole })
        .eq("email", target)
        .select("email");

      if (profileError !== null) {
        throw new StaffError("Could not change that role. Please try again.");
      }

      // No profile exists until first sign-in; updating nothing is correct then.
      const { error: inviteError } = await client
        .from("staff_invitations")
        .update({ role: newRole })
        .eq("email", target)
        .select("email");

      if (inviteError !== null) {
        throw new StaffError(
          "Their signed-in role was changed, but the invitation was not. Please try again.",
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

    async resendInvite(email) {
      const actor = await getActor();
      if (actor.role !== "admin") {
        throw new StaffError("Only an Admin may resend invitations.");
      }

      const target = email.trim().toLowerCase();
      const staff = await repository.list();
      const member = staff.find((m) => m.email.toLowerCase() === target);
      if (member === undefined) throw new StaffError("That staff member no longer exists.");

      const roleName = member.role.replaceAll("_", " ");
      const campusNames = member.campuses.map((c) => c.name);

      const emailObj = composeStaffInviteEmail({
        fullName: member.fullName,
        roleName,
        campuses: campusNames,
        email: member.email,
        loginUrl: "https://pms.faceprepcampus.com/login",
      });

      const { error } = await client.from("email_deliveries").insert({
        recipient_email: member.email,
        status: "queued",
        subject: emailObj.subject,
        html_body: emailObj.html,
      });

      if (error !== null) {
        throw new StaffError("Could not queue invitation email. Please try again.");
      }
    },
  };

  return repository;
}
