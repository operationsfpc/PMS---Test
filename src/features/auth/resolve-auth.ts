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
export async function resolveAuthState(client: SupabaseClient): Promise<AuthState> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) return { status: "signed-out" };

  const email = session.user.email ?? "";

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profile) {
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

    return { status: "signed-in", role: profile.role as AppRole, email, campuses };
  }

  const { data: student } = await client
    .from("students")
    .select("id, auth_user_id")
    .or(`auth_user_id.eq.${session.user.id},email.eq.${email}`)
    .maybeSingle();

  if (student) {
    if (!student.auth_user_id) {
      await client
        .from("students")
        .update({ auth_user_id: session.user.id })
        .eq("id", student.id);
    }
    // A student is not staff: there are no assignment rows to read, and asking
    // would be a round trip that can only ever come back empty.
    return { status: "signed-in", role: "student", email, campuses: [] };
  }

  return { status: "unrecognised", email };
}
