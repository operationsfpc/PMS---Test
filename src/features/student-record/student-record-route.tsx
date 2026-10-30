import { Card } from "@components/ui";
import { canReleasePlacementHold, HOLD_READER_ROLES } from "@domain/holds";
import { useAuth } from "@lib/auth-context";
import { createSupabaseHoldsView } from "@lib/holds-view";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useParams } from "react-router";
import { StudentRecordPage } from "./student-record-page";
import { createSupabaseStudentRecordView } from "./student-record-view";

/**
 * `/students/:studentId` — the canonical student record (G7, Q7 answer b).
 * RLS decides who may read the row; a student asking about someone else gets
 * the same "does not exist" as a URL that was never real.
 */
export function StudentRecordRoute() {
  const { studentId } = useParams();
  const [view] = useState(() => createSupabaseStudentRecordView(supabase()));
  const [holds] = useState(() => createSupabaseHoldsView(supabase()));
  // Signed-out never reaches here (RequireAuth), but the fallback is the
  // least-privileged role rather than the most convenient one.
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : "student";

  /**
   * The hold block is handed to the roles 0125 admits, and the release verb to
   * the Campus Manager alone. `release_student_hold` refuses everyone else
   * regardless — this is the near side that stops the screen drawing a button
   * whose only answer would be a failure.
   */
  const mayRead = HOLD_READER_ROLES.includes(role);
  const release = mayRead && canReleasePlacementHold(role) ? holds.release : undefined;
  const canManagePreferences = role !== "student";

  if (studentId === undefined) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">No student named in the address.</p>
      </Card>
    );
  }

  return (
    <StudentRecordPage
      studentId={studentId}
      view={view}
      canManagePreferences={canManagePreferences}
      {...(mayRead ? { holds } : {})}
      {...(release === undefined ? {} : { release })}
    />
  );
}
