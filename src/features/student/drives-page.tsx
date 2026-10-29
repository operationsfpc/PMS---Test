import { supabase } from "@lib/supabase";
import { useState } from "react";
import { DriveTabs, type StudentDriveListsView } from "./drive-tabs";
import { createSupabaseDrivesView } from "./drives-view";

/**
 * Route wrapper: the student's Drives area lists future drives and the
 * applications still moving (N7, approved 2026-08-19; narrowed 2026-10-29).
 */
export function StudentDrivesPage({ view }: { view?: StudentDriveListsView }) {
  const [resolved] = useState<StudentDriveListsView>(
    () => view ?? createSupabaseDrivesView(supabase()),
  );
  return <DriveTabs view={resolved} />;
}
