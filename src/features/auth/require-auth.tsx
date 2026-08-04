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

  // An unrecognised account is authenticated but belongs to nobody here. The
  // login screen is where that gets explained, so both go to the same place.
  if (auth.status === "signed-out" || auth.status === "unrecognised") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
