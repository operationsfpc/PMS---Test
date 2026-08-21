import { DrivePicker, type PickerDrive } from "@components/drive-picker";
import { Card, PageHeader } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { fetchDriveRounds, fetchPickerDrives, type PickerRound } from "@lib/drive-picker-data";
import { supabase } from "@lib/supabase";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AttendancePage } from "./attendance-page";
import { createSupabaseAttendanceView } from "./attendance-view";

/**
 * Route wrapper for attendance.
 *
 * `?round=` marks that round. `?drive=` lists the drive's rounds to pick
 * from, and with neither, the M1 picker (2026-08-21) — this page used to
 * dead-end at "Choose a round…" with no rounds anywhere on it, reported as
 * "rounds are not populated in the attendance page".
 */
export function AttendanceRoute() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const roundId = params.get("round");
  const driveId = params.get("drive");

  const [view] = useState(() =>
    createSupabaseAttendanceView(
      supabase(),
      async () => {
        const { data } = await supabase().auth.getSession();
        return data.session?.user.id ?? null;
      },
      async () => (auth.status === "signed-in" ? auth.role : "student"),
    ),
  );

  const [drives, setDrives] = useState<readonly PickerDrive[] | null>(null);
  const [rounds, setRounds] = useState<readonly PickerRound[] | null>(null);

  useEffect(() => {
    if (roundId !== null) return;
    if (driveId !== null) {
      void fetchDriveRounds(supabase(), driveId).then(setRounds);
      return;
    }
    void fetchPickerDrives(supabase()).then(setDrives);
  }, [roundId, driveId]);

  if (roundId !== null) {
    return <AttendancePage roundId={roundId} view={view} />;
  }

  if (driveId !== null) {
    return (
      <>
        <PageHeader title="Attendance" subtitle="Choose the round to mark." />
        <Card className="p-6">
          {rounds === null ? (
            <p role="status" className="text-sm text-ink-500">
              Loading rounds…
            </p>
          ) : rounds.length === 0 ? (
            <p className="text-sm text-ink-700">
              This drive has no rounds yet. Rounds are created on the Rounds &amp; results screen.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {rounds.map((round) => (
                <li key={round.roundId} className="py-3">
                  <Link
                    to={`/cpc/attendance?round=${round.roundId}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Round {round.sequence} — {round.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
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
      makeLink={(id) => `/cpc/attendance?drive=${id}`}
      prompt="Choose a drive to mark attendance for its rounds."
    />
  );
}
