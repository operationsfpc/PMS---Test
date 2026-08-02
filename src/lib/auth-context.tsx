import type { AppRole } from "@domain/types";
import { createContext, useContext } from "react";

/**
 * Who is signed in, if anyone.
 *
 * Lives in `lib` rather than in a feature because every feature needs it, and
 * `src/architecture.test.ts` forbids one feature importing another. Sharing it
 * through a feature would make `features/auth` a hidden dependency of the
 * whole application.
 *
 * `loading` is a distinct state on purpose: Supabase restores a session from
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
