import { supabase } from "@lib/supabase";
import { useState } from "react";
import { CampusPage } from "./campus-page";
import { createSupabaseCampusRepository } from "./campus-repository";

/** Route wrapper: the screen takes an injected repository so it stays testable. */
export function AdminCampusRoute() {
  const [repository] = useState(() => createSupabaseCampusRepository(supabase()));
  return <CampusPage repository={repository} />;
}
