import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { SkillsAssessedPage } from "./skills-assessed-page";
import { createSupabaseSkillsView } from "./skills-view";

/** Route wrapper for the assessed-skills master list (2026-08-24, 3a). */
export function SkillsAssessedRoute() {
  const auth = useAuth();

  const [view] = useState(() =>
    createSupabaseSkillsView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  return <SkillsAssessedPage view={view} />;
}
