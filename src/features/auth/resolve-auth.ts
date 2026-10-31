import type { AppRole } from "@domain/types";
import type { AuthState } from "@lib/auth-context";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turns a Supabase session into an identity the UI can route on.
 *
 * Staff carry a `profiles` row holding their role. Students deliberately do
 * not - they are identified by their roster record in `students`, claimed on
 * first sign-in by the trigger in 0009_guards.sql.
 *
 * The final case is NOT unreachable, though it was assumed to be: the
 * allowlist only guards the creation of an auth.users row, and that row
 * outlives both the invitation and the profile. Someone removed and re-invited
 * still has an account, so this ran in production and returned signed-out,
 * which read as "nothing happened".
 *
 * It never assumes 'student' - handing an unidentifiable account a student's
 * view would be a data exposure. It reports the address instead, so the login
 * screen can explain the refusal to the person it is refusing.
 */
/**
 * The row's own name, only when it actually carried one.
 *
 * `full_name` is NOT NULL in `profiles` and in `students`, so the database
 * cannot hand back a missing one — but the client here is untyped and a caller
 * that reads a different column set returns an absent key. Leaving `name` off
 * is honest: the shell then says who by their address instead of showing a
 * blank where a person's name should be.
 */
function nameOf(row: Record<string, unknown>): { name?: string } {
  return typeof row.full_name === "string" && row.full_name !== "" ? { name: row.full_name } : {};
}

export async function resolveAuthState(client: SupabaseClient): Promise<AuthState> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) return { status: "signed-out" };

  const email = session.user.email ?? "";

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role, is_active, full_name")
    .eq("id", session.user.id)
    .maybeSingle();

  // A refused read is not "this account belongs to nobody". Telling a Delivery
  // Head their own address is not set up for placements — the sentence this
  // function returns when a profile genuinely is absent — sends them to write
  // to support about a fault in the network.
  if (profileError !== null) return { status: "unreadable", email };

  if (profile) {
    // An admin toggled is_active off: the DB blocks every query for this
    // account, so the UI must not pretend they are signed in.
    if (profile.is_active === false) {
      return { status: "deactivated", email };
    }
    /**
     * The campuses this staff member is mapped to.
     *
     * Read here rather than by the shell, so it arrives with the identity and
     * every screen can rely on it. A failure is reported as "no campuses"
     * rather than thrown: not knowing the campus must never cost someone
     * their session.
     */
    const { data: assignments } = await client
      .from("staff_campus_assignments")
      .select("campuses(name)")
      .eq("profile_id", session.user.id);

    const campuses = (assignments ?? []).flatMap((row: Record<string, unknown>) => {
      const campus = (Array.isArray(row.campuses) ? row.campuses[0] : row.campuses) as
        | { name?: string }
        | null
        | undefined;
      return campus?.name === undefined ? [] : [campus.name];
    });

    return {
      status: "signed-in",
      role: profile.role as AppRole,
      email,
      campuses,
      ...nameOf(profile),
    };
  }

  const { data: student, error: studentError } = await client
    .from("students")
    .select("id, auth_user_id, full_name")
    .or(`auth_user_id.eq.${session.user.id},email.eq.${email}`)
    .maybeSingle();

  if (studentError !== null) return { status: "unreadable", email };

  if (student) {
    if (!student.auth_user_id) {
      await client.from("students").update({ auth_user_id: session.user.id }).eq("id", student.id);
    }
    // A student is not staff: there are no assignment rows to read, and asking
    // would be a round trip that can only ever come back empty.
    return { status: "signed-in", role: "student", email, campuses: [], ...nameOf(student) };
  }

  return { status: "unrecognised", email };
}
