import { supabase } from "@lib/supabase";
import { useState } from "react";
import { DrivesList, type DrivesView } from "./drives-list";
import { createSupabaseDrivesView } from "./drives-view";

/** Route wrapper: builds the live view once and hands it to the list. */
export function StudentDrivesPage({ view }: { view?: DrivesView }) {
  const [resolved] = useState<DrivesView>(() => view ?? createSupabaseDrivesView(supabase()));
  return <DrivesList view={resolved} />;
}
