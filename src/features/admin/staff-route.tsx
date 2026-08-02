import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { StaffPage } from "./staff-page";
import { createSupabaseStaffRepository } from "./staff-repository";

/** Route wrapper: builds the live repository, keeping the screen injectable. */
export function AdminStaffRoute() {
  const auth = useAuth();
  const [repository] = useState(() =>
    createSupabaseStaffRepository(supabase(), async () =>
      auth.status === "signed-in" ? auth.role : "student",
    ),
  );
  return <StaffPage repository={repository} />;
}
