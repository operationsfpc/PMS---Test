import { landingRouteForRole, studentLandingRoute } from "@domain/auth-routing";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "./require-auth";
import {
  createSupabaseStudentStanding,
  type ReadStudentStanding,
  type StudentStanding,
} from "./student-standing";

/**
 * Sends a freshly signed-in user to their own screen.
 *
 * Sits behind RequireAuth, so by the time it renders the user is signed in.
 * Every role has a landing route, and the compiler enforces that.
 *
 * A STUDENT is the one case a role cannot answer on its own. Asked for
 * 2026-08-06: "when a student logs in for the first time, he should directly
 * land on the registration page." Whether that is right depends on facts the
 * session does not carry - whether they have registered, and whether they are
 * still participating - so those are read first, and the decision itself stays
 * in `studentLandingRoute`.
 */
export function RoleLanding({
  /** Injected so the routing can be tested without a database. */
  readStanding,
}: {
  readStanding?: ReadStudentStanding;
} = {}) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  const [standing, setStanding] = useState<StudentStanding | null | undefined>(undefined);

  useEffect(() => {
    // Nobody else pays for this lookup: no other role has a student record,
    // and this sits on the critical path of every single login.
    if (role !== "student") return;

    let active = true;
    const read = readStanding ?? createSupabaseStudentStanding(supabase());

    void read()
      // Null, not a guess. Sending them to the form when we cannot tell
      // whether it is even the right screen is the one unrecoverable outcome:
      // an opted-out student must never be asked to register.
      .catch(() => null)
      .then((next) => {
        if (active) setStanding(next);
      });

    return () => {
      active = false;
    };
  }, [role, readStanding]);

  if (auth.status !== "signed-in") return null;

  if (auth.role !== "student") {
    return <Navigate to={landingRouteForRole(auth.role)} replace />;
  }

  if (standing === undefined) {
    // A blank screen here reads as a broken login - this is the moment
    // straight after a student enters their password.
    return (
      <p role="status" className="p-8 text-sm text-ink-500">
        Signing you in…
      </p>
    );
  }

  return (
    <Navigate
      to={standing === null ? landingRouteForRole("student") : studentLandingRoute(standing)}
      replace
    />
  );
}
