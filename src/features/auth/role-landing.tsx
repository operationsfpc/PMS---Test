import { landingRouteForRole } from "@domain/auth-routing";
import { Navigate } from "react-router";
import { useAuth } from "./require-auth";

/**
 * Sends a freshly signed-in user to their own screen.
 *
 * Sits behind RequireAuth, so by the time it renders the user is signed in.
 * Every role has a landing route, and the compiler enforces that.
 */
export function RoleLanding() {
  const auth = useAuth();
  if (auth.status !== "signed-in") return null;

  return <Navigate to={landingRouteForRole(auth.role)} replace />;
}
