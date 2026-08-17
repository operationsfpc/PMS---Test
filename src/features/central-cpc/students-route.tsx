import { supabase } from "@lib/supabase";
import { useState } from "react";
import { StudentDirectoryPage } from "./students-page";
import { createSupabaseStudentDirectoryView } from "./students-view";

/** Route wrapper: builds the live directory view. RLS decides who is in it. */
export function StudentDirectoryRoute() {
  const [view] = useState(() => createSupabaseStudentDirectoryView(supabase()));
  return <StudentDirectoryPage view={view} />;
}
