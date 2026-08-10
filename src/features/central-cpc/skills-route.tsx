import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { SkillsPage } from "./skills-page";
import { createSupabaseSkillsView } from "./skills-view";

/** Route wrapper for the skill repository (PRD §5). */
export function SkillsRoute() {
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

  return <SkillsPage view={view} />;
}
