import { supabase } from "@lib/supabase";
import { useState } from "react";
import { OffCampusPage } from "./off-campus-page";
import { OptOutPage } from "./opt-out-page";
import { createSupabaseParticipationView } from "./participation-view";

/**
 * Route wrappers for the two participation screens (F2, UAT 2026-08-06).
 *
 * One view, two routes: both read the same student row and the same request
 * history, so building the view twice would double the round trips to say the
 * same thing.
 */
function useParticipationView() {
  const [view] = useState(() =>
    createSupabaseParticipationView(supabase(), async () => {
      const { data } = await supabase().auth.getSession();
      const authUserId = data.session?.user.id;
      if (authUserId === undefined) return null;

      const { data: student } = await supabase()
        .from("students")
        .select("id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      return (student?.id as string | undefined) ?? null;
    }),
  );

  return view;
}

export function StudentOptOutRoute() {
  return <OptOutPage view={useParticipationView()} />;
}

export function StudentOffCampusRoute() {
  return <OffCampusPage view={useParticipationView()} />;
}
