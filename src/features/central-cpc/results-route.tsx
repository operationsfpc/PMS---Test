import { DrivePicker, type PickerDrive } from "@components/drive-picker";
import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { fetchPickerDrives } from "@lib/drive-picker-data";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DriveRoundsPage, ResultsPage } from "./results-page";
import { createSupabaseResultsView } from "./results-view";

/**
 * Route wrapper for rounds & results.
 *
 * `?drive=` opens the tabbed rounds screen (WS6, 2026-08-12). `?round=` is
 * kept for older links and records against that single round. With neither,
 * the M1 picker (2026-08-21): company + role + raised date, searchable,
 * oldest first — an empty screen with no way forward is how "data not
 * reflecting" reports start.
 */
export function ResultsRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const driveId = params.get("drive");
  const roundId = params.get("round");

  const [view] = useState(() =>
    createSupabaseResultsView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  const [drives, setDrives] = useState<readonly PickerDrive[] | null>(null);

  useEffect(() => {
    if (driveId !== null || roundId !== null) return;
    void fetchPickerDrives(supabase()).then(setDrives);
  }, [driveId, roundId]);

  if (driveId !== null) {
    return <DriveRoundsPage driveId={driveId} view={view} />;
  }

  if (roundId !== null) {
    return <ResultsPage roundId={roundId} view={view} />;
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
      makeLink={(id) => `/central/results?drive=${id}`}
      prompt="Choose a drive to run its rounds."
    />
  );
}
