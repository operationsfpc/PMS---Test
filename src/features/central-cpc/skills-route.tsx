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

  // 2026-08-24 (Karthik): every role but the operator pair reads only.
  const role = auth.status === "signed-in" ? auth.role : "student";
  const readOnly = role !== "central_placement_coordinator" && role !== "admin";

  return <SkillsPage view={view} readOnly={readOnly} />;
}
