import { supabase } from "@lib/supabase";
import { useMemo } from "react";
import { ProfileEditPage } from "./profile-edit";
import { createSupabaseStudentProfileRepository } from "./profile-repository";

/**
 * Route wrapper. Memoised so the repository keeps its identity across
 * renders - the page loads on mount keyed by it, and a fresh object every
 * render would reload in a loop. That exact mistake, made with a default
 * parameter, had one student writing ~50 rows a minute to `students`.
 */
export function StudentProfileRoute() {
  const repository = useMemo(() => createSupabaseStudentProfileRepository(supabase()), []);
  return <ProfileEditPage repository={repository} />;
}
