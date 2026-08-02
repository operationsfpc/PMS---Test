import { supabase } from "@lib/supabase";
import { useState } from "react";
import { CockpitPage } from "./cockpit-page";
import { createSupabaseCockpitView } from "./cockpit-view";

/** Route wrapper: builds the live cockpit view. */
export function CockpitRoute() {
  const [view] = useState(() => createSupabaseCockpitView(supabase()));
  return <CockpitPage view={view} />;
}
