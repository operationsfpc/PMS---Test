import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useRef, useState } from "react";
import { StaffPage } from "./staff-page";
import { createSupabaseStaffRepository } from "./staff-repository";

/** Route wrapper: builds the live repository, keeping the screen injectable. */
export function AdminStaffRoute() {
  const auth = useAuth();
  // Read through a ref, not a closure over the first render: removing your own
  // account and demoting the last Admin are both refused by identity, so a
  // stale actor here would be a real hole rather than a stale label.
  const actor = useRef(auth);
  actor.current = auth;

  const [repository] = useState(() =>
    createSupabaseStaffRepository(supabase(), async () =>
      actor.current.status === "signed-in"
        ? { role: actor.current.role, email: actor.current.email }
        : { role: "student" as const, email: "" },
    ),
  );
  return <StaffPage repository={repository} />;
}
