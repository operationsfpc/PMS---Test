import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { type CockpitFilter, CockpitPage } from "./cockpit-page";
import { createSupabaseCockpitView } from "./cockpit-view";

/** Route wrapper: builds the live cockpit view. */
export function CockpitRoute({ filter }: { filter?: CockpitFilter } = {}) {
  const auth = useAuth();
  const [view] = useState(() => createSupabaseCockpitView(supabase()));
  // Signed-out never reaches here (RequireAuth), but the fallback is the
  // least-privileged role rather than the most convenient one.
  const role = auth.status === "signed-in" ? auth.role : "student";
  return <CockpitPage view={view} filter={filter} role={role} />;
}
