import { supabase } from "@lib/supabase";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseAddSemesterView } from "./add-semester-repository";
import { SrfPage } from "./srf-page";
import { createSupabaseSrfProfile, type SrfProfile } from "./srf-profile";

/**
 * Route wrapper: loads the student's roster record before rendering the form.
 *
 * Name, roll number and email are not the student's to type - those fields are
 * disabled - so the form is held back until the record arrives. Rendering
 * first and filling in afterwards would flash somebody else's blank identity
 * and, worse, let React Hook Form capture the empty values as its defaults.
 */
export function SrfRoute() {
  const [profile, setProfile] = useState<SrfProfile | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    // A student who cannot be matched to a roster record still gets the form,
    // with nothing prefilled, rather than a blank screen. Losing the prefill
    // is a nuisance; losing the form is the end of their registration.
    const load = async (): Promise<SrfProfile | null> => {
      try {
        return await createSupabaseSrfProfile(supabase())();
      } catch {
        return null;
      }
    };

    void load().then((next) => {
      if (active) setProfile(next);
    });

    return () => {
      active = false;
    };
  }, []);

  /**
   * F13. Built from the profile because it needs the student's own marks
   * scale - one per degree, unchanging - and their id. Both arrive with the
   * profile, so there is nothing to build until it does.
   */
  const addSemester = useMemo(
    () =>
      createSupabaseAddSemesterView(
        supabase(),
        async () => {
          const { data } = await supabase().auth.getSession();
          const authUserId = data.session?.user.id;
          if (authUserId === undefined) return null;

          const { data: student } = await supabase()
            .from("students")
            .select("id")
            .eq("auth_user_id", authUserId)
            .maybeSingle();

          return (student?.id as string | undefined) ?? null;
        },
        profile?.marksScale ?? "cgpa",
      ),
    [profile?.marksScale],
  );

  if (profile === undefined) {
    return (
      <p role="status" className="p-8 text-sm text-ink-500">
        Loading your details…
      </p>
    );
  }

  return (
    <SrfPage
      profile={profile}
      draft={profile?.draft ?? null}
      // Decides whether this is a form or a record. A student whose roster row
      // could not be read falls back to an editable form: losing the prefill
      // is a nuisance, but locking someone out of registering is the end of it.
      status={profile?.srfStatus ?? "registered"}
      rejectionReason={profile?.rejectionReason ?? null}
      addSemester={addSemester}
      // F6: degree+branch is one choice, and it is their college's to offer.
      programmes={profile?.programmes ?? []}
    />
  );
}
