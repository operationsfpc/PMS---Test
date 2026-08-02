import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { AttendancePage } from "./attendance-page";
import { createSupabaseAttendanceView } from "./attendance-view";

/**
 * Route wrapper for attendance.
 *
 * The round is chosen elsewhere and arrives as `?round=`. Without one there is
 * nothing to mark, and inventing a default would risk marking the wrong round.
 */
export function AttendanceRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const roundId = params.get("round");

  const [view] = useState(() =>
    createSupabaseAttendanceView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  if (roundId === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">
          Choose a round from the drive to mark attendance for it.
        </p>
      </Card>
    );
  }

  return <AttendancePage roundId={roundId} view={view} />;
}
