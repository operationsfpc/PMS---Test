import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { DashboardPage } from "./dashboard-page";
import { createSupabaseDashboardView } from "./dashboard-view";

/**
 * One dashboard, labelled per role.
 *
 * RLS already scopes what each role can read, so the same view serves a CEO
 * and a Campus Manager - the Campus Manager simply sees fewer rows. Building a
 * separate screen per role would be four chances to compute "placed"
 * differently.
 */
const TITLES: Record<string, string> = {
  ceo: "Executive overview",
  key_account_manager: "Account overview",
  enterprise_relations: "Enterprise relations overview",
  er_head: "Enterprise relations overview",
  campus_manager: "Campus overview",
  delivery_head: "Delivery overview",
  admin: "Overview",
};

export function DashboardRoute() {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : "student";
  const [view] = useState(() => createSupabaseDashboardView(supabase()));

  return <DashboardPage view={view} title={TITLES[role] ?? "Overview"} />;
}
