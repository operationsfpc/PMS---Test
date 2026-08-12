import { supabase } from "@lib/supabase";
import { useState } from "react";
import { DriveProgressPage } from "./drive-progress-page";
import { createSupabaseDriveProgressView } from "./drive-progress-view";

/** Route wrapper: the campus coordinator's full-cycle view (D10). */
export function DriveProgressRoute() {
  const [view] = useState(() => createSupabaseDriveProgressView(supabase()));
  return <DriveProgressPage view={view} />;
}
