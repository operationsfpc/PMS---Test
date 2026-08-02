import { Badge, Card, PageHeader } from "@components/ui";
import type { DriveStatus } from "@domain/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";

export interface CockpitRound {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
}

export interface DriveSummary {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly status: DriveStatus;
  readonly onHold: boolean;
  readonly applicationCount: number;
  readonly rounds: readonly CockpitRound[];
}

export interface DisbarmentReview {
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly absences: number;
}

export interface CockpitView {
  drives(): Promise<readonly DriveSummary[]>;
  /** R8: students at or past the absence limit. A REVIEW, never a sanction. */
  reviews(): Promise<readonly DisbarmentReview[]>;
}

const STATUS_TONE: Record<DriveStatus, "neutral" | "brand" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "warning",
  approved: "warning",
  live: "brand",
  applications_closed: "neutral",
  in_rounds: "brand",
  completed: "success",
  rejected: "danger",
};

const label = (value: string) => value.replaceAll("_", " ");

/**
 * The Central CPC's cockpit.
 *
 * A work queue, not an inventory: each drive shows the one thing it is waiting
 * for. It is also the only place that supplies the drive and round ids the
 * other Central CPC screens need, so every action links from here.
 */
export function CockpitPage({ view }: { view: CockpitView }) {
  const [drives, setDrives] = useState<readonly DriveSummary[] | null>(null);
  const [reviews, setReviews] = useState<readonly DisbarmentReview[]>([]);

  useEffect(() => {
    void view.drives().then(setDrives);
    void view.reviews().then(setReviews);
  }, [view]);

  return (
    <div>
      <PageHeader title="Drive cockpit" subtitle="Every drive, and what it is waiting for." />

      {reviews.length > 0 && (
        <Card className="mb-6 p-5">
          <h2 className="text-lg text-ink-900">Absence reviews</h2>
          <p className="mt-1 text-sm text-ink-700">
            R8: reaching the absence limit raises a review. It is never an automatic sanction — the
            decision is yours.
          </p>
          <ul className="mt-3 divide-y divide-neutral-200">
            {reviews.map((review) => (
              <li key={review.studentId} className="flex items-center justify-between gap-4 py-2">
                <div>
                  <p className="font-medium text-ink-900">{review.studentName}</p>
                  <p className="text-sm text-ink-500">
                    {review.rollNumber} · {review.absences} absences
                  </p>
                </div>
                <Badge tone="warning">Needs review</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drives === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading drives…
        </p>
      ) : drives.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No drives yet. An Account Executive raises one, and the Delivery Head approves it.
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {drives.map((drive) => (
              <li key={drive.driveId} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{drive.companyName}</p>
                    <p className="text-sm text-ink-500">
                      {drive.roleTitle ?? "Role not set"} · {drive.applicationCount} applicants
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[drive.status]}>{label(drive.status)}</Badge>
                    {drive.onHold && <Badge tone="warning">On hold</Badge>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {(drive.status === "approved" || drive.status === "draft") && (
                    <Link
                      to={`/central/publish?drive=${drive.driveId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Complete and publish
                    </Link>
                  )}

                  {(drive.status === "live" ||
                    drive.status === "applications_closed" ||
                    drive.status === "in_rounds") && (
                    <Link
                      to={`/central/shortlisting?drive=${drive.driveId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Shortlist applicants
                    </Link>
                  )}

                  {drive.rounds.map((round) => (
                    <Link
                      key={round.roundId}
                      to={`/central/results?round=${round.roundId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {round.sequence}. {round.name}
                    </Link>
                  ))}

                  {(drive.status === "in_rounds" || drive.status === "completed") && (
                    <Link
                      to={`/central/offers?drive=${drive.driveId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Final selection
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
