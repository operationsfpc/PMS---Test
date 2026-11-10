import { canPlacePlacementHold, HOLD_READER_ROLES } from "@domain/holds";
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
   * Holds are managed by Central Placement Coordinator and Admin.
   */
  const mayReadHolds = HOLD_READER_ROLES.includes(role);
  const asHolds: HoldsView | undefined = mayReadHolds ? holds : undefined;
  const canPlace = canPlacePlacementHold(role);

  return (
    <StudentDirectoryPage
      view={view}
      {...(asHolds === undefined ? {} : { holds: asHolds })}
      canPlace={canPlace}
    />
  );
}
