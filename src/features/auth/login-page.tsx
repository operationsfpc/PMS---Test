import { Button } from "@components/ui";
import { useAuthActions } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "./require-auth";

/** Where a refused or confused user is told to write. */
export const SUPPORT_EMAIL = "hello@faceprep.in";

/**
 * The single sign-in screen for every role.
 *
 * Refusals are deliberately reworded. `0009_guards.sql` raises
 * "Address x is not registered. Ask your placement coordinator for an
 * invitation." — accurate, but it leaks database phrasing at a moment when the
 * user is already confused, and a staff member has no placement coordinator to
 * ask. Both cases get a plain explanation and somewhere to write instead.
 */
function refusalMessage(errorDescription: string): string {
  const notOnAllowlist = /not registered/i.test(errorDescription);

  return notOnAllowlist
    ? `That Google account is not set up for placements yet. Write to ${SUPPORT_EMAIL} to get invited to the placement management system.`
    : `Sign-in could not be completed. Please try again. If it keeps happening, write to ${SUPPORT_EMAIL} to get invited to the placement management system.`;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const { signOut } = useAuthActions();
  const error = params.get("error");

  // Two different refusals land here. One never got a session at all (the
  // allowlist fired before the account was created); the other has a perfectly
  // good Google session that matches nobody in this system, and without a way
  // to end it they cannot even try another account. A third has a profile but
  // an admin deactivated it - they need to know who to contact.
  const stranded = auth.status === "unrecognised";
  const deactivated = auth.status === "deactivated";
  const unreadable = auth.status === "unreadable";

  const message = deactivated
    ? `The account ${auth.email} has been deactivated. Write to ${SUPPORT_EMAIL} or contact your administrator to restore access.`
    : stranded
      ? `You are signed in to Google as ${auth.email}, but that address is not set up for placements. Write to ${SUPPORT_EMAIL} to get invited, or sign out and use the account your college has on record.`
      : unreadable
        ? `You are signed in to Google as ${auth.email}, but we could not check whether that address is set up for placements — the database did not answer. This is not a problem with your account. Try again.`
        : error === null
          ? null
          : refusalMessage(params.get("error_description") ?? "");

  async function signIn() {
    await supabase().auth.signInWithOAuth({
      provider: "google",
      // Must be /login: Supabase returns OAuth *errors* here too, and an
      // allowlist refusal would be lost anywhere else.
      options: { redirectTo: `${window.location.origin}/login` },
    });
  }

  // A successful sign-in also lands here. Hand over to role routing.
  if (auth.status === "signed-in") return <Navigate to="/" replace />;

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="font-heading text-2xl font-bold text-brand-500">FACE Prep Campus</h1>
        <p className="mt-1 text-sm text-neutral-600">Placement Management System</p>

        {message !== null && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500"
          >
            {message}
          </p>
        )}

        {unreadable ? (
          // Nothing is wrong with this account, so signing out is not the fix
          // and signing in again only re-runs the same Google hop. Asking the
          // question once more is.
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
            Try again
          </Button>
        ) : stranded || deactivated ? (
          <Button className="mt-6 w-full" onClick={() => void signOut()}>
            Use a different account
          </Button>
        ) : (
          <Button className="mt-6 w-full" onClick={signIn}>
            Sign in with Google
          </Button>
        )}

        <p className="mt-6 text-xs text-neutral-500">
          Use the Google account your college or administrator has on record.
        </p>
      </div>
    </main>
  );
}
