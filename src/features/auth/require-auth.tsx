import type { AppRole } from "@domain/types";
import { createContext, type ReactNode, useContext } from "react";
import { Navigate } from "react-router";

/**
 * Who is signed in, if anyone.
 *
 * `loading` is a distinct state on purpose. Supabase restores a session from
 * storage asynchronously, so the first render of a signed-in user looks
 * identical to a signed-out one. Collapsing the two would redirect a valid
 * user to /login on every page refresh.
 */
export type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly role: AppRole; readonly email: string };

export const AuthContext = createContext<AuthState>({ status: "loading" });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <p role="status" className="p-8 text-sm text-neutral-500">
        Checking your sign-in…
      </p>
    );
  }

  if (auth.status === "signed-out") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
