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
  /**
   * Authenticated with Google, but matched to no staff invitation and no
   * roster record. Distinct from `signed-out` on purpose: collapsing the two
   * produced an invisible loop - Google signs them in, the app sends them back
   * to /login, Google signs them in again, and nothing ever says why.
   */
  | { readonly status: "unrecognised"; readonly email: string }
  | {
      readonly status: "signed-in";
      readonly role: AppRole;
      readonly actualRole?: AppRole;
      readonly previewRole?: AppRole | null;
      readonly email: string;
      /**
       * The campuses a staff member is mapped to, by name. Empty for students
       * and for organisation-wide roles.
       *
       * Shown beneath the role because the mapping IS the authority: a
       * coordinator verifies the students of their campus and no others. One
       * mapped to nothing sees an empty queue, and until this was on screen
       * there was no way to tell that from a campus with nobody in it.
       */
      readonly campuses: readonly string[];
    };

export const AuthContext = createContext<AuthState>({ status: "loading" });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * What a signed-in user can do about being signed in.
 *
 * Separate from `AuthState` because state is a value that changes on every
 * auth event, and this is a stable capability. Keeping them apart means the
 * shell can offer a way out without subscribing to session churn.
 *
 * The default is a no-op rather than a throw: `AppShell` renders in tests and
 * in development previews that have no provider above them, and a shell that
 * crashes because nobody can sign out is worse than a button that does nothing.
 */
export interface AuthActions {
  signOut(): Promise<void>;
  setPreviewRole?(role: AppRole | null): void;
}

export const AuthActionsContext = createContext<AuthActions>({
  signOut: async () => {},
  setPreviewRole: () => {},
});

export function useAuthActions(): AuthActions {
  return useContext(AuthActionsContext);
}
