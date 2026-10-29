import { useAuth } from "@lib/auth-context";
import { createSupabaseHoldsView, type HoldsView } from "@lib/holds-view";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { StudentDirectoryPage } from "./students-page";
import { createSupabaseStudentDirectoryView } from "./students-view";

/** Route wrapper: builds the live directory view. RLS decides who is in it. */
export function StudentDirectoryRoute() {
  const auth = useAuth();
  const [view] = useState(() => createSupabaseStudentDirectoryView(supabase()));
  const [holds] = useState(() => createSupabaseHoldsView(supabase()));
  // Signed-out never reaches here (RequireAuth), but the fallback is the
  // least-privileged role rather than the most convenient one.
  const role = auth.status === "signed-in" ? auth.role : "student";

  /**
   * The one write this page offers, and only a Campus Manager is handed it —
   * the near side of 0125, whose `place_student_hold` refuses every other role
   * and every student outside the manager's own college. Absent, the page draws
   * no Hold button: RLS has already narrowed the roster to their students.
   */
  const asHolds: HoldsView | undefined = role === "campus_manager" ? holds : undefined;

  return (
    <StudentDirectoryPage view={view} {...(asHolds === undefined ? {} : { holds: asHolds })} />
  );
}
