import type { AppRole } from "@domain/types";
import { type AuthActions, AuthActionsContext, isTestPreviewAllowed } from "@lib/auth-context";
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
  const [previewRole, setPreviewRole] = useState<AppRole | null>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("fpc_preview_role") as AppRole | null;
      return stored || null;
    }
    return null;
  });

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

  const handleSetPreviewRole = (role: AppRole | null) => {
    setPreviewRole(role);
    if (typeof window !== "undefined") {
      if (role) {
        sessionStorage.setItem("fpc_preview_role", role);
      } else {
        sessionStorage.removeItem("fpc_preview_role");
      }
    }
  };

  const effectiveState = useMemo<AuthState>(() => {
    if (state.status !== "signed-in") return state;
    const canPreview = isTestPreviewAllowed(state.email);
    if (!canPreview || !previewRole) return state;

    return {
      ...state,
      actualRole: state.role,
      role: previewRole,
      previewRole,
      campuses:
        state.campuses.length > 0
          ? state.campuses
          : previewRole === "campus_placement_coordinator" ||
              previewRole === "campus_manager" ||
              previewRole === "key_account_manager"
            ? ["Alliance University", "VIT Bangalore"]
            : [],
    };
  }, [state, previewRole]);

  /**
   * Signing out goes through Supabase so the stored session is destroyed, not
   * merely forgotten in memory - it lives in localStorage and would otherwise
   * come back on the next reload. `onAuthStateChange` then re-resolves and
   * RequireAuth sends them to /login, so there is no navigation to do here.
   */
  const actions = useMemo<AuthActions>(
    () => ({
      signOut: async () => {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("fpc_preview_role");
        }
        await supabase().auth.signOut();
      },
      setPreviewRole: handleSetPreviewRole,
    }),
    [],
  );

  return (
    <AuthActionsContext.Provider value={actions}>
      <AuthContext.Provider value={effectiveState}>{children}</AuthContext.Provider>
    </AuthActionsContext.Provider>
  );
}
