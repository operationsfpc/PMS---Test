import { Card } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DriveRoundsPage, ResultsPage } from "./results-page";
import { createSupabaseResultsView, type DriveInProgress } from "./results-view";

/**
 * Route wrapper for rounds & results.
 *
 * `?drive=` opens the tabbed rounds screen (WS6, 2026-08-12). `?round=` is
 * kept for older links and records against that single round. With neither,
 * the coordinator picks a drive — an empty screen with no way forward is how
 * "data not reflecting" reports start.
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

  const [drives, setDrives] = useState<readonly DriveInProgress[] | null>(null);

  useEffect(() => {
    if (driveId !== null || roundId !== null) return;
    void view.drivesInProgress().then(setDrives);
  }, [view, driveId, roundId]);

  if (driveId !== null) {
    return <DriveRoundsPage driveId={driveId} view={view} />;
  }

  if (roundId !== null) {
    return <ResultsPage roundId={roundId} view={view} />;
  }

  return (
    <Card className="p-6">
      <p className="text-sm text-ink-700">Choose a drive to run its rounds.</p>
      {drives === null ? (
        <p role="status" className="mt-3 text-sm text-ink-500">
          Loading drives…
        </p>
      ) : drives.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No drives are in progress.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {drives.map((drive) => (
            <li key={drive.driveId}>
              <Link
                to={`/central/results?drive=${drive.driveId}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {drive.companyName}
              </Link>{" "}
              <span className="text-xs text-ink-500">{drive.status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
