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
 * CONFIRMED: everyone signing in is staff or student, guaranteed by the login
 * allowlist. The final fallback is therefore unreachable in practice. It
 * returns signed-out rather than assuming 'student', because handing an
 * unidentifiable account a student's view of the system would be a data
 * exposure, and a refused login is the safer failure.
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
    return { status: "signed-in", role: profile.role as AppRole, email };
  }

  const { data: student } = await client
    .from("students")
    .select("id")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (student) {
    return { status: "signed-in", role: "student", email };
  }

  return { status: "signed-out" };
}
