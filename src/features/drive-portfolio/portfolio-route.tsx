import { DRIVE_TAB_STATUSES, type DriveTab } from "@domain/drive-lifecycle";
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

/**
 * The Central CPC's two card-design tabs (2026-08-18). The heading names the
 * status group, so the page cannot say "Live" over a drive nobody has published.
 */
const TABS: Readonly<Record<DriveTab, { title: string; subtitle: string }>> = {
  "yet-to-publish": {
    title: "Yet to publish",
    subtitle: "Approved by the Delivery Head, waiting to be published.",
  },
  live: {
    title: "Live",
    subtitle: "Published and running — what students can see, and how far each has got.",
  },
  completed: { title: "Completed", subtitle: "Finished drives, and what came of them." },
};

export function DrivePortfolioRoute({ tab }: { tab?: DriveTab } = {}) {
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
      title={
        tab === undefined
          ? ((role === null ? undefined : TITLES[role]) ?? "My drives")
          : TABS[tab].title
      }
      {...(tab === undefined ? {} : { statuses: DRIVE_TAB_STATUSES[tab] })}
    />
  );
}
