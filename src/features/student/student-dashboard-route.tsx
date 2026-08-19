import { supabase } from "@lib/supabase";
import { useState } from "react";
import { NotificationsPage } from "./notifications-page";
import { StudentDashboard } from "./student-dashboard";
import { createSupabaseStudentDashboardView } from "./student-dashboard-view";

/** Route wrapper: builds the signed-in student's own dashboard. */
export function StudentDashboardRoute() {
  const [view] = useState(() => createSupabaseStudentDashboardView(supabase()));
  return <StudentDashboard view={view} />;
}

/** E1's "Read More" destination — every notification, on its own page. */
export function StudentNotificationsRoute() {
  const [view] = useState(() => createSupabaseStudentDashboardView(supabase()));
  return <NotificationsPage view={view} />;
}
