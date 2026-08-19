import { supabase } from "@lib/supabase";
import { useState } from "react";
import { DriveTabs, type StudentDriveListsView } from "./drive-tabs";
import { createSupabaseDrivesView } from "./drives-view";

/**
 * Route wrapper: the student's Drives area is the four lists now (N7,
 * approved 2026-08-19). The old single list lives on inside the To-apply tab.
 */
export function StudentDrivesPage({ view }: { view?: StudentDriveListsView }) {
  const [resolved] = useState<StudentDriveListsView>(
    () => view ?? createSupabaseDrivesView(supabase()),
  );
  return <DriveTabs view={resolved} />;
}
