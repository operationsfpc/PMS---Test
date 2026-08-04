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
  central_placement_coordinator: "My drives",
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
      title={(role === null ? undefined : TITLES[role]) ?? "My drives"}
    />
  );
}
