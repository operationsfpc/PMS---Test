import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { OffCampusQueue } from "./off-campus-queue";
import { OptOutQueue } from "./opt-out-queue";
import { createSupabaseParticipationQueueView } from "./participation-view";

/**
 * Route wrappers for the two approval queues (F2, UAT 2026-08-06).
 *
 * The actor's role is read from the session rather than assumed: the domain
 * refuses a decision by anyone who is not a coordinator, and it can only do
 * that if it is told who is asking.
 */
function useQueueView() {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : "student";

  const [view] = useState(() =>
    createSupabaseParticipationQueueView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => role,
    ),
  );

  return view;
}

export function OptOutQueueRoute() {
  return <OptOutQueue view={useQueueView()} />;
}

export function OffCampusQueueRoute() {
  return <OffCampusQueue view={useQueueView()} />;
}
