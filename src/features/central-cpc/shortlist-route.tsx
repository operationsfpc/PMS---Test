import { DrivePicker } from "@components/drive-picker";
import { ErrorPanel } from "@components/error-panel";
import { Card } from "@components/ui";
import { canExportShortlist } from "@domain/drive-portfolio";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { usePickerDrives } from "@lib/use-picker-drives";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ShortlistPage } from "./shortlist-page";
import { createSupabaseShortlistView } from "./shortlist-view";

/** Route wrapper for shortlisting. The drive arrives as `?drive=`. */
export function ShortlistRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const driveId = params.get("drive");

  // Asked at the moment it matters, not captured once at first render: the
  // session's role may not be resolved yet when this route mounts.
  const currentRole = () => (auth.status === "signed-in" ? auth.role : ("student" as const));

  const [view] = useState(() =>
    createSupabaseShortlistView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => currentRole(),
    ),
  );

  // M1 (2026-08-21): this page dead-ended at "Choose a drive…" with no
  // list at all — reported as "the shortlisting page is empty".
  const { drives, failed, retry } = usePickerDrives(driveId === null);

  if (driveId === null) {
    if (failed) {
      return (
        <ErrorPanel onRetry={() => void retry()}>
          We could not load the drives to choose from.
        </ErrorPanel>
      );
    }
    if (drives === null) {
      return (
        <Card className="p-6">
          <p role="status" className="text-sm text-ink-500">
            Loading drives…
          </p>
        </Card>
      );
    }
    return (
      <DrivePicker
        drives={drives}
        makeLink={(id) => `/central/shortlisting?drive=${id}`}
        prompt="Choose a drive to shortlist its applicants."
      />
    );
  }

  return (
    <ShortlistPage driveId={driveId} view={view} canExport={canExportShortlist(currentRole())} />
  );
}
