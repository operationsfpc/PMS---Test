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

  return { status: "unrecognised", email };
}
