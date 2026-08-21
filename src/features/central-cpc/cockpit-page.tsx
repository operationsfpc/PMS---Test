import { Badge, Button, Card, PageHeader } from "@components/ui";
import { describeCtcRange } from "@domain/ctc";
import {
  compareOldestFirst,
  daysPending,
  describeRaisedOn,
  isPendingTooLong,
  partitionExpired,
} from "@domain/drive-aging";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import { canPublishDrive, canShortlistFromPortfolio } from "@domain/drive-portfolio";
import { canEditDriveVenue, describeDriveVenue, driveVenueApplies } from "@domain/drive-venue";
import type { OfferCategory } from "@domain/offer-category";
import {
  classifyOfferCategory,
  OFFER_CATEGORIES,
  offerCategoryLabel,
} from "@domain/offer-category";
import type { AppRole, DriveStatus } from "@domain/types";
import { useCallback, useEffect, useState } from "react";
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
  /** C3 (UAT 2026-08-19): role + CTC is what tells two same-company drives apart. */
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  readonly status: DriveStatus;
  readonly onHold: boolean;
  readonly applicationCount: number;
  readonly rounds: readonly CockpitRound[];
  /** G1a (UAT 2026-08-20): when it was raised — the queue's age. */
  readonly createdAt: string | null;
  /** G1d: when applications close — past it, the drive is expired. */
  readonly applicationEnd: string | null;
  /**
   * UAT 2026-08-21 item 2: the drive's mode and its off-campus venue. Both
   * optional so older fixtures and views stay valid; absent reads as "no
   * venue to speak of".
   */
  readonly driveMode?: string | null;
  readonly venue?: string | null;
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
  /**
   * UAT 2026-08-21 item 2: record the confirmed venue of an off-campus
   * drive, post-submission. Offered to the Central CPC alone (answer Q5).
   */
  updateVenue?(driveId: string, venue: string): Promise<void>;
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
 * D2 (2026-08-12): the Central CPC sees what awaits publishing and what is
 * already out, separately. A rejected drive appears in neither — it is
 * terminal, and it is the Delivery Head's record, not this queue's.
 */
export type CockpitFilter = "yet-to-publish" | "published";

const FILTERS: Record<
  CockpitFilter,
  { title: string; subtitle: string; empty: string; statuses: readonly DriveStatus[] }
> = {
  "yet-to-publish": {
    title: "Yet to publish",
    subtitle:
      "Approved by the Delivery Head — or still on their desk. Complete and publish from here.",
    empty: "Nothing is waiting to be published.",
    statuses: ["draft", "submitted", "approved"],
  },
  published: {
    title: "Published",
    subtitle: "Live and beyond — the drives students can see or have been through.",
    empty: "Nothing has been published yet.",
    statuses: ["live", "applications_closed", "in_rounds", "completed"],
  },
};

/**
 * The Central CPC's cockpit.
 *
 * A work queue, not an inventory: each drive shows the one thing it is waiting
 * for. It is also the only place that supplies the drive and round ids the
 * other Central CPC screens need, so every action links from here.
 */
export function CockpitPage({
  view,
  filter,
  role,
  now,
  decide,
}: {
  view: CockpitView;
  filter?: CockpitFilter | undefined;
  /**
   * Decides which actions are offered, and nothing else. Required rather than
   * defaulted: a permissive default is a permission granted by forgetfulness.
   */
  role: AppRole;
  /** Passed in for tests; the route leaves it unset and the wall clock rules. */
  now?: Date;
  /**
   * G1c (UAT 2026-08-20): the Delivery Head approves or rejects a submitted
   * drive from THIS list. Wired by the route for the delivery head alone —
   * absent, the buttons do not exist.
   */
  decide?: (driveId: string, current: DriveStatus, decision: PifDecision) => Promise<void>;
}) {
  // 2026-08-17 (Karthik): the AE views drive status and results; they neither
  // publish nor shortlist. The domain owns both answers - this screen only asks.
  const mayPublish = canPublishDrive(role);
  const mayShortlist = canShortlistFromPortfolio(role);
  const [loaded, setLoaded] = useState<readonly DriveSummary[] | null>(null);
  const [reviews, setReviews] = useState<readonly DisbarmentReview[]>([]);
  /** G1b: oldest first is how a backlog is cleared, so the queue defaults to it. */
  const [sort, setSort] = useState<"oldest" | "newest">(
    filter === "yet-to-publish" ? "oldest" : "newest",
  );
  /** G1c: the pending decision, its category (approve) or reason (reject). */
  const [deciding, setDeciding] = useState<{
    drive: DriveSummary;
    kind: "approve" | "reject";
  } | null>(null);
  const [category, setCategory] = useState<OfferCategory>("regular");
  const [reason, setReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  /** UAT 2026-08-21 item 2: the venue being recorded, and its text. */
  const [venueEditing, setVenueEditing] = useState<DriveSummary | null>(null);
  const [venueText, setVenueText] = useState("");
  const [venueError, setVenueError] = useState<string | null>(null);

  const load = useCallback(() => {
    void view.drives().then(setLoaded);
    void view.reviews().then(setReviews);
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  const clock = now ?? new Date();
  const scope = filter === undefined ? null : FILTERS[filter];
  const inScope =
    loaded === null || scope === null
      ? loaded
      : loaded.filter((d) => scope.statuses.includes(d.status));

  const sorted =
    inScope === null
      ? null
      : sort === "oldest"
        ? [...inScope].sort(compareOldestFirst)
        : [...inScope].sort((a, b) => compareOldestFirst(b, a));

  const drives = sorted;
  const split = drives === null ? null : partitionExpired(drives, clock);

  /** Q5 (2026-08-21): the venue is the Central CPC's to record — nobody else's. */
  const mayRecordVenue = view.updateVenue !== undefined && canEditDriveVenue(role);

  function openVenue(drive: DriveSummary) {
    setVenueText(drive.venue ?? "");
    setVenueError(null);
    setVenueEditing(drive);
  }

  async function saveVenue() {
    if (venueEditing === null || view.updateVenue === undefined) return;
    if (venueText.trim() === "") {
      setVenueError("Type the venue — an empty venue is “not yet confirmed”, not a venue.");
      return;
    }
    try {
      await view.updateVenue(venueEditing.driveId, venueText.trim());
      setVenueEditing(null);
      setVenueText("");
      setVenueError(null);
      load();
    } catch (cause) {
      setVenueError(cause instanceof Error ? cause.message : "Could not save the venue.");
    }
  }

  function openDecision(drive: DriveSummary, kind: "approve" | "reject") {
    setCategory(classifyOfferCategory(drive.ctcMaxLpa ?? drive.ctcMinLpa ?? 0));
    setReason("");
    setDecisionError(null);
    setDeciding({ drive, kind });
  }

  async function confirmDecision() {
    if (deciding === null || decide === undefined) return;
    const intent: PifDecision =
      deciding.kind === "approve"
        ? { decision: "approve", offerCategory: category }
        : { decision: "reject", reason: reason.trim() };

    // The same rule the repository and the database enforce — asked here so
    // the answer arrives without a round trip, never instead of them.
    const check = decidePif("submitted", intent);
    if (!check.ok) {
      setDecisionError(check.error);
      return;
    }

    try {
      await decide(deciding.drive.driveId, "submitted", intent);
      setDeciding(null);
      load();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "Could not save the decision.");
    }
  }

  return (
    <div>
      <PageHeader
        title={scope?.title ?? "Drive cockpit"}
        subtitle={scope?.subtitle ?? "Every drive, and what it is waiting for."}
      />

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

      {drives === null || split === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading drives…
        </p>
      ) : drives.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            {scope?.empty ??
              "No drives yet. An Account Executive raises one, and the Delivery Head approves it."}
          </p>
        </Card>
      ) : (
        <>
          {/* G1b (UAT 2026-08-20): "oldest submitted first" is how a backlog
              is cleared, so the queue defaults to it and says so. */}
          <div className="mb-3 flex justify-end">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "oldest" | "newest")}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-900"
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
          </div>

          {split.active.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-ink-700">
                {scope?.empty ?? "Nothing needs action right now."}
              </p>
            </Card>
          ) : (
            <DriveList
              drives={split.active}
              now={clock}
              mayPublish={mayPublish}
              mayShortlist={mayShortlist}
              onDecide={decide === undefined ? null : openDecision}
              onEditVenue={mayRecordVenue ? openVenue : null}
            />
          )}

          {/* G1d (answer 1a): expired drives collapse on the SAME list —
              out of the way, never destroyed. */}
          {split.expired.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-ink-500">
                Expired — application deadline passed ({split.expired.length})
              </summary>
              <div className="mt-3">
                <DriveList
                  drives={split.expired}
                  now={clock}
                  mayPublish={mayPublish}
                  mayShortlist={mayShortlist}
                  onDecide={decide === undefined ? null : openDecision}
                  onEditVenue={mayRecordVenue ? openVenue : null}
                />
              </div>
            </details>
          )}
        </>
      )}

      {/* UAT 2026-08-21 item 2: recording the confirmed venue. */}
      {venueEditing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-label="Update venue"
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">
              Venue — {venueEditing.companyName}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              As confirmed by the company. Students see it on the drive card.
            </p>

            {venueError !== null && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {venueError}
              </p>
            )}

            <div className="mt-3">
              <label
                htmlFor="cockpit-venue"
                className="mb-1 block text-sm font-medium text-ink-900"
              >
                Venue
              </label>
              <input
                id="cockpit-venue"
                value={venueText}
                onChange={(e) => setVenueText(e.target.value)}
                placeholder="e.g. HCL Campus, Sholinganallur, Chennai"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setVenueEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => void saveVenue()}>Save venue</Button>
            </div>
          </div>
        </div>
      )}

      {/* G1c: the decision, from the list — same rules as the approval queue. */}
      {deciding !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label={deciding.kind === "approve" ? "Approve drive" : "Reject drive"}
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">
              {deciding.kind === "approve" ? "Approve" : "Reject"} {deciding.drive.companyName}?
            </h2>

            {decisionError !== null && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {decisionError}
              </p>
            )}

            {deciding.kind === "approve" ? (
              <div className="mt-3">
                <label
                  htmlFor="cockpit-category"
                  className="mb-1 block text-sm font-medium text-ink-900"
                >
                  Offer category
                </label>
                <select
                  id="cockpit-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as OfferCategory)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                >
                  {OFFER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {offerCategoryLabel(c)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-warning">
                  Suggested from the CTC. This cannot be changed later.
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <label
                  htmlFor="cockpit-reason"
                  className="mb-1 block text-sm font-medium text-ink-900"
                >
                  Rejection reason
                </label>
                <input
                  id="cockpit-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Required. Rejection is final — the PIF cannot be edited or resubmitted.
                </p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmDecision()}>
                {deciding.kind === "approve" ? "Confirm — approve" : "Confirm — reject permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The card list — one renderer for the active and the expired sections. */
function DriveList({
  drives,
  now,
  mayPublish,
  mayShortlist,
  onDecide,
  onEditVenue,
}: {
  drives: readonly DriveSummary[];
  now: Date;
  mayPublish: boolean;
  mayShortlist: boolean;
  onDecide: ((drive: DriveSummary, kind: "approve" | "reject") => void) | null;
  /** UAT 2026-08-21 item 2 — wired for the Central CPC alone (answer Q5). */
  onEditVenue: ((drive: DriveSummary) => void) | null;
}) {
  return (
    <Card>
      <ul className="divide-y divide-neutral-200">
        {drives.map((drive) => {
          const raised = describeRaisedOn(drive.createdAt);
          const pendingDays = daysPending(drive.createdAt, now);
          const unpublished =
            drive.status === "draft" || drive.status === "submitted" || drive.status === "approved";

          return (
            <li key={drive.driveId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{drive.companyName}</p>
                  <p className="text-sm text-ink-500">
                    {drive.roleTitle ?? "Role not set"}
                    {describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa) !== null &&
                      ` · ${describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa)}`}{" "}
                    · {drive.applicationCount} applicants
                  </p>
                  {/* G1a: the age of the submission, stated on the card. */}
                  {raised !== null && <p className="mt-0.5 text-xs text-ink-500">{raised}</p>}
                  {/* UAT 2026-08-21 item 2: where an off-campus drive happens —
                      "to be confirmed" is said out loud, never left blank. */}
                  {describeDriveVenue(
                    (drive.driveMode ?? null) as Parameters<typeof describeDriveVenue>[0],
                    drive.venue ?? null,
                  ) !== null && (
                    <p className="mt-0.5 text-xs text-ink-500">
                      Venue:{" "}
                      {describeDriveVenue(
                        (drive.driveMode ?? null) as Parameters<typeof describeDriveVenue>[0],
                        drive.venue ?? null,
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[drive.status]}>{label(drive.status)}</Badge>
                  {drive.onHold && <Badge tone="warning">On hold</Badge>}
                  {/* G1a: flagged only while it awaits someone's action. */}
                  {unpublished && isPendingTooLong(drive.createdAt, now) && (
                    <Badge tone="warning">Pending {pendingDays} days</Badge>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {/* B2 (UAT 2026-08-19): every card opens the record page,
                    whatever its status — a submitted drive awaiting the
                    Delivery Head used to be a dead end with no link at all. */}
                <Link
                  to={`/drives/${drive.driveId}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  View drive
                </Link>

                {/* UAT 2026-08-21 item 2: the venue stays editable after
                    submission — the company confirms it late, the CPC records
                    it here. */}
                {onEditVenue !== null &&
                  drive.status !== "draft" &&
                  driveVenueApplies(
                    (drive.driveMode ?? null) as Parameters<typeof driveVenueApplies>[0],
                  ) && (
                    <Button size="sm" variant="secondary" onClick={() => onEditVenue(drive)}>
                      Update venue…
                    </Button>
                  )}

                {/* G1c: the Delivery Head's one action, on the list itself. */}
                {onDecide !== null && drive.status === "submitted" && (
                  <>
                    <Button size="sm" onClick={() => onDecide(drive, "approve")}>
                      Approve…
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onDecide(drive, "reject")}>
                      Reject…
                    </Button>
                  </>
                )}

                {mayPublish && (drive.status === "approved" || drive.status === "draft") && (
                  <Link
                    to={`/central/publish?drive=${drive.driveId}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Complete and publish
                  </Link>
                )}

                {mayShortlist &&
                  (drive.status === "live" ||
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
                    to={`/central/results?drive=${drive.driveId}`}
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
          );
        })}
      </ul>
    </Card>
  );
}
