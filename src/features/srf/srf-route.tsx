import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
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
    />
  );
}
