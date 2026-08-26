import { supabase } from "@lib/supabase";
import { useState } from "react";
import { AeOverviewPage } from "./overview-page";
import { createSupabaseAeOverviewView } from "./overview-view";

/**
 * The Account Executive's landing page (approved 2026-08-26).
 *
 * No role check here: RLS returns only the drives they raised, and
 * `placement_totals()` refuses anyone who is not staff. A guard in the browser
 * would be a suggestion; the database is the thing that actually refuses.
 */
export function AeOverviewRoute() {
  const [view] = useState(() => createSupabaseAeOverviewView(supabase()));

  return <AeOverviewPage view={view} />;
}
