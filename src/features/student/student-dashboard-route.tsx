import { supabase } from "@lib/supabase";
import { useState } from "react";
import { StudentDashboard } from "./student-dashboard";
import { createSupabaseStudentDashboardView } from "./student-dashboard-view";

/** Route wrapper: builds the signed-in student's own dashboard. */
export function StudentDashboardRoute() {
  const [view] = useState(() => createSupabaseStudentDashboardView(supabase()));
  return <StudentDashboard view={view} />;
}
