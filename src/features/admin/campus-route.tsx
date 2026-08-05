import { supabase } from "@lib/supabase";
import { useState } from "react";
import { CampusPage } from "./campus-page";
import { createSupabaseCampusProgrammesView } from "./campus-programmes-repository";
import { createSupabaseCampusRepository } from "./campus-repository";

/**
 * Route wrapper: the screen takes injected dependencies so it stays testable.
 *
 * Programmes arrive here rather than on a page of their own (F6): they are the
 * college's, for a passing year, and maintaining them anywhere else is what
 * let one Admin's new branch appear at every college in the country.
 */
export function AdminCampusRoute() {
  const [repository] = useState(() => createSupabaseCampusRepository(supabase()));
  const [programmes] = useState(() => createSupabaseCampusProgrammesView(supabase()));

  return <CampusPage repository={repository} programmes={programmes} />;
}
