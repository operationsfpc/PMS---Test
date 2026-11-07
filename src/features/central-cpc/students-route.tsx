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
   * Holds are visible to Campus Manager, KAM and Admin.
   * Only Campus Manager places hold requests; KAM approves.
   */
  const mayReadHolds =
    role === "campus_manager" || role === "key_account_manager" || role === "admin";
  const asHolds: HoldsView | undefined = mayReadHolds ? holds : undefined;
  const canPlace = role === "campus_manager" || role === "admin";

  return (
    <StudentDirectoryPage
      view={view}
      {...(asHolds === undefined ? {} : { holds: asHolds })}
      canPlace={canPlace}
    />
  );
}
