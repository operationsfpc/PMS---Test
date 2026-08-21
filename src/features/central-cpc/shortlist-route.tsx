import { DrivePicker, type PickerDrive } from "@components/drive-picker";
import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { fetchPickerDrives } from "@lib/drive-picker-data";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ShortlistPage } from "./shortlist-page";
import { createSupabaseShortlistView } from "./shortlist-view";

/** Route wrapper for shortlisting. The drive arrives as `?drive=`. */
export function ShortlistRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const driveId = params.get("drive");

  const [view] = useState(() =>
    createSupabaseShortlistView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  // M1 (2026-08-21): this page dead-ended at "Choose a drive…" with no
  // list at all — reported as "the shortlisting page is empty".
  const [drives, setDrives] = useState<readonly PickerDrive[] | null>(null);

  useEffect(() => {
    if (driveId !== null) return;
    void fetchPickerDrives(supabase()).then(setDrives);
  }, [driveId]);

  if (driveId === null) {
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

  return <ShortlistPage driveId={driveId} view={view} />;
}
