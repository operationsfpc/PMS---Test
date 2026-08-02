import { supabase } from "@lib/supabase";
import { useState } from "react";
import { ProgrammesPage } from "./programmes-page";
import { createSupabaseProgrammesRepository } from "./programmes-repository";

/** Route wrapper: builds the live repository, keeping the screen injectable. */
export function AdminProgrammesRoute() {
  const [repository] = useState(() => createSupabaseProgrammesRepository(supabase()));
  return <ProgrammesPage repository={repository} />;
}
