import { type AuthActions, AuthActionsContext } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AuthContext, type AuthState } from "./require-auth";
import { resolveAuthState } from "./resolve-auth";

/**
 * Publishes the live Supabase session to the rest of the app.
 *
 * Starts as `loading`, never `signed-out`: reading the stored session is
 * async, and a premature `signed-out` would bounce a returning user to /login
 * before their session had a chance to load.
 *
 * Re-resolves on every auth change, because sign-in also has to fetch the
 * user's role from the database before the UI can route them.
 */
export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const client = supabase();

    const refresh = () => {
      void resolveAuthState(client).then((next) => {
        if (active) setState(next);
      });
    };

    refresh();
    const { data } = client.auth.onAuthStateChange(refresh);

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  /**
   * Signing out goes through Supabase so the stored session is destroyed, not
   * merely forgotten in memory - it lives in localStorage and would otherwise
   * come back on the next reload. `onAuthStateChange` then re-resolves and
   * RequireAuth sends them to /login, so there is no navigation to do here.
   */
  const actions = useMemo<AuthActions>(
    () => ({
      signOut: async () => {
        await supabase().auth.signOut();
      },
    }),
    [],
  );

  return (
    <AuthActionsContext.Provider value={actions}>
      <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
    </AuthActionsContext.Provider>
  );
}
