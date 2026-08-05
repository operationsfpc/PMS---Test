import type { AppRole } from "@domain/types";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { DrivePortfolioPage } from "./portfolio-page";
import { createSupabasePortfolioView } from "./portfolio-view";

/**
 * One screen, labelled for whichever role is looking at it.
 *
 * The Delivery Head approves drives and the AE raises them, so the same page
 * answers "what became of the ones I approved?" and "what became of the ones I
 * raised?". RLS decides which drives come back; the label only sets the
 * expectation.
 */
const TITLES: Partial<Record<AppRole, string>> = {
  account_executive: "My drives",
  delivery_head: "Drives I approved",
  // F15: the Central CPC sees every drive, not a set they raised, so calling
  // it "my drives" for them would be a lie the sidebar tells.
  central_placement_coordinator: "All drives",
};

export function DrivePortfolioRoute() {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;
  const [view] = useState(() => createSupabasePortfolioView(supabase()));

  // `profiles.id` IS `auth.uid()`, so the session carries everything needed to
  // tell "raised by me" from "raised by someone else". It arrives
  // asynchronously, and guessing before it does would label a drive wrongly.
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setProfileId(data.session?.user.id ?? "");
      })
      .catch(() => {
        if (live) setProfileId("");
      });
    return () => {
      live = false;
    };
  }, []);

  if (profileId === null) {
    return (
      <p role="status" className="text-sm text-ink-500">
        Loading your drives…
      </p>
    );
  }

  return (
    <DrivePortfolioPage
      view={view}
      profileId={profileId}
      // F15: shortlisting access is decided from the role, by the domain.
      role={role ?? "account_executive"}
      title={(role === null ? undefined : TITLES[role]) ?? "My drives"}
    />
  );
}
