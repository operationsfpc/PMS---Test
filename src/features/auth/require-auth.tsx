import { type AuthState, useAuth } from "@lib/auth-context";
import type { ReactNode } from "react";
import { Navigate } from "react-router";

// The context itself lives in @lib so every feature can reach it without
// importing another feature (src/architecture.test.ts).
export { AuthContext, type AuthState, useAuth } from "@lib/auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth: AuthState = useAuth();

  if (auth.status === "loading") {
    return (
      <p role="status" className="p-8 text-sm text-neutral-500">
        Checking your sign-in…
      </p>
    );
  }

  // An unrecognised account is authenticated but belongs to nobody here. A
  // deactivated one has a profile but an admin turned it off. Both need the
  // login screen to explain what happened.
  if (auth.status === "signed-out" || auth.status === "unrecognised" || auth.status === "deactivated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
