import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { ParticipationQueue } from "./participation-queue";
import { createSupabaseParticipationQueueView } from "./participation-view";

/** Route wrapper for the coordinator's opt-out and off-campus approvals. */
export function ParticipationQueueRoute() {
  const auth = useAuth();
  const [view] = useState(() =>
    createSupabaseParticipationQueueView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  return <ParticipationQueue view={view} />;
}
