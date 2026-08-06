import { supabase } from "@lib/supabase";
import { useMemo } from "react";
import { ProfileEditPage } from "./profile-edit";
import {
  createSupabaseStudentCertificates,
  createSupabaseStudentProfileRepository,
} from "./profile-repository";

/**
 * Route wrapper. Memoised so the repositories keep their identity across
 * renders - the page loads on mount keyed by them, and a fresh object every
 * render would reload in a loop. That exact mistake, made with a default
 * parameter, had one student writing ~50 rows a minute to `students`.
 */
export function StudentProfileRoute() {
  const repository = useMemo(() => createSupabaseStudentProfileRepository(supabase()), []);

  const certificates = useMemo(
    () =>
      createSupabaseStudentCertificates(supabase(), async () => {
        const { data } = await supabase().auth.getSession();
        const authUserId = data.session?.user.id;
        if (authUserId === undefined) return null;

        const { data: student } = await supabase()
          .from("students")
          .select("id")
          .eq("auth_user_id", authUserId)
          .maybeSingle();

        return (student?.id as string | undefined) ?? null;
      }),
    [],
  );

  return <ProfileEditPage repository={repository} certificates={certificates} />;
}
