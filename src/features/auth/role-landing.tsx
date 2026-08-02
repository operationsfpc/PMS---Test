import { landingRouteForRole } from "@domain/auth-routing";
import { Navigate } from "react-router";
import { useAuth } from "./require-auth";

/**
 * Sends a freshly signed-in user to their own screen.
 *
 * Sits behind RequireAuth, so by the time it renders the user is signed in.
 * Roles with no screen yet get told so plainly - redirecting them to another
 * role's dashboard would be both wrong and, under RLS, empty.
 */
export function RoleLanding() {
  const auth = useAuth();
  if (auth.status !== "signed-in") return null;

  const route = landingRouteForRole(auth.role);
  if (route !== null) return <Navigate to={route} replace />;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <p role="status" className="max-w-md text-center text-sm text-neutral-600">
        You are signed in as <strong>{auth.email}</strong>, but there is no dashboard yet for the{" "}
        <strong>{auth.role.replaceAll("_", " ")}</strong> role. It is still being built.
      </p>
    </div>
  );
}
