import { supabase } from "@lib/supabase";
import { useState } from "react";
import { ParticipationPage } from "./participation-page";
import { createSupabaseParticipationView } from "./participation-view";

/** Route wrapper: resolves the signed-in student's own record. */
export function ParticipationRoute() {
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

  return <ParticipationPage view={view} />;
}
