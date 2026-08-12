import { supabase } from "@lib/supabase";
import { useState } from "react";
import { type CockpitFilter, CockpitPage } from "./cockpit-page";
import { createSupabaseCockpitView } from "./cockpit-view";

/** Route wrapper: builds the live cockpit view. */
export function CockpitRoute({ filter }: { filter?: CockpitFilter } = {}) {
  const [view] = useState(() => createSupabaseCockpitView(supabase()));
  return <CockpitPage view={view} filter={filter} />;
}
