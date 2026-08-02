import { Button } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useSearchParams } from "react-router";

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
    ? `That Google account is not set up for placements yet. Students are added by their college; staff are invited by an administrator. If you believe this is a mistake, write to ${SUPPORT_EMAIL}.`
    : `Sign-in could not be completed. Please try again. If it keeps happening, write to ${SUPPORT_EMAIL}.`;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get("error");
  const message = error === null ? null : refusalMessage(params.get("error_description") ?? "");

  async function signIn() {
    await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F5F5F5] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="font-[Raleway] text-2xl font-bold text-[#3D3777]">FACE Prep Campus</h1>
        <p className="mt-1 text-sm text-neutral-600">Placement Management System</p>

        {message !== null && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-[#DD4820] bg-[#FFF0EC] p-3 text-sm text-[#DD4820]"
          >
            {message}
          </p>
        )}

        <Button className="mt-6 w-full" onClick={signIn}>
          Sign in with Google
        </Button>

        <p className="mt-6 text-xs text-neutral-500">
          Use the Google account your college or administrator has on record.
        </p>
      </div>
    </main>
  );
}
