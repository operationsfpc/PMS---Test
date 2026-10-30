import { DrivePicker } from "@components/drive-picker";
import { ErrorPanel } from "@components/error-panel";
import { Card, PageHeader } from "@components/ui";
import { useAuth } from "@lib/auth-context";
import { fetchDriveRounds, type PickerRound } from "@lib/drive-picker-data";
import { supabase } from "@lib/supabase";
import { usePickerDrives } from "@lib/use-picker-drives";
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

  const { drives, failed, retry } = usePickerDrives(roundId === null && driveId === null);
  const [rounds, setRounds] = useState<readonly PickerRound[] | null>(null);
  const [roundsFailed, setRoundsFailed] = useState(false);
  const [roundsAttempt, setRoundsAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: roundsAttempt re-runs the read on purpose
  useEffect(() => {
    if (roundId !== null || driveId === null) return;
    let live = true;
    setRoundsFailed(false);
    fetchDriveRounds(supabase(), driveId)
      .then((next) => {
        if (live) setRounds(next);
      })
      .catch(() => {
        // A rejected read must not leave this on "Loading rounds…" forever.
        if (live) {
          setRounds(null);
          setRoundsFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [roundId, driveId, roundsAttempt]);

  if (roundId !== null) {
    return <AttendancePage roundId={roundId} view={view} />;
  }

  if (driveId !== null) {
    return (
      <>
        <PageHeader title="Attendance" subtitle="Choose the round to mark." />
        {roundsFailed ? (
          <ErrorPanel
            onRetry={() => {
              setRoundsFailed(false);
              setRoundsAttempt((count) => count + 1);
            }}
          >
            We could not load this drive&rsquo;s rounds.
          </ErrorPanel>
        ) : (
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
              <ul className="divide-y divide-line">
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
        )}
      </>
    );
  }

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
      makeLink={(id) => `/cpc/attendance?drive=${id}`}
      prompt="Choose a drive to mark attendance for its rounds."
    />
  );
}
