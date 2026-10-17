import { DriveSort } from "@components/drive-sort";
import { DriveTypeFilter } from "@components/drive-type-filter";
import { StudentIdentity } from "@components/student-identity";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  PageHeader,
} from "@components/ui";
import { countDistinctApplicants, groupDrivesByEvent } from "@domain/company-drive";
import { describeCtcRange } from "@domain/ctc";
import {
  type DriveOrder,
  daysPending,
  describeRaisedOn,
  isPendingTooLong,
  orderDrives,
  partitionExpired,
} from "@domain/drive-aging";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import { canPublishDrive, canShortlistFromPortfolio } from "@domain/drive-portfolio";
import {
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { canEditDriveVenue, describeDriveVenue, driveVenueApplies } from "@domain/drive-venue";
import type { OfferCategory } from "@domain/offer-category";
import {
  offerCategoriesFor,
  offerCategoryLabel,
  requiredOfferCategoryFor,
  suggestOfferCategory,
} from "@domain/offer-category";
import { describeStipendRange } from "@domain/stipend";
import type { AppRole, DriveStatus, DriveType } from "@domain/types";
import { describeReadFailure } from "@lib/postgrest-read";
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
  /** 2026-08-27: an internship pays this instead of a CTC. */
  readonly stipendMinMonthly?: number | null;
  readonly stipendMaxMonthly?: number | null;
  /** 2026-08-27: filtered on, tagged on the card, and it fixes the category. */
  readonly driveType?: DriveType | null;
  readonly status: DriveStatus;
  readonly onHold: boolean;
  readonly applicationCount: number;
  /**
   * Who applied, in the same read that produced the count. Optional so older
   * fixtures stay valid — a count with nobody behind it is a card that cannot
   * open, not a card that lies.
   */
  readonly applicantStudentIds?: readonly string[];
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
  /** Multi-role grouping: the parent event ID (null for legacy standalone drives). */
  readonly companyDriveId?: string | null;
  /** Multi-role grouping: the event date. */
  readonly tentativeDate?: string | null;
  /**
   * The colleges the drive targets — the "who is this for" answer on the
   * card. Optional so older fixtures stay valid; absent reads as unknown,
   * and an EMPTY array reads as "open to every campus".
   */
  readonly campuses?: readonly string[];
}

export interface DisbarmentReview {
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  /** Which campus the student belongs to — this review spans all of them. */
  readonly college: string | null;
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
  decide?: (
    driveId: string,
    current: DriveStatus,
    decision: PifDecision,
    driveType?: DriveType | null,
  ) => Promise<void>;
}) {
  // 2026-08-17 (Karthik): the AE views drive status and results; they neither
  // publish nor shortlist. The domain owns both answers - this screen only asks.
  const mayPublish = canPublishDrive(role);
  const mayShortlist = canShortlistFromPortfolio(role);
  const [loaded, setLoaded] = useState<readonly DriveSummary[] | null>(null);
  const [reviews, setReviews] = useState<readonly DisbarmentReview[]>([]);
  /** G1b: oldest first is how a backlog is cleared, so the queue defaults to it. */
  /**
   * 2026-08-26 (Karthik): "change the default sort order to Newest First
   * across all sections" — a deliberate reversal of G1b's oldest-first default
   * on the publish queue. Clearing the backlog from the back is still one
   * click away; it is no longer what the reader is given unasked.
   */
  const [sort, setSort] = useState<DriveOrder>("newest");
  const [type, setType] = useState<DriveTypeFilterValue>("");
  /** G1c: the pending decision, its category (approve) or reason (reject). */
  const [deciding, setDeciding] = useState<{
    drive: DriveSummary;
    kind: "approve" | "reject";
  } | null>(null);
  // Empty means "nobody has chosen yet" — §3.3 makes the category immutable
  // once written, so it must never arrive pre-chosen by a default.
  const [category, setCategory] = useState<OfferCategory | null>(null);
  const [reason, setReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  /** A decision or a venue is a WRITE: while one is out, its button is shut. */
  const [savingDecision, setSavingDecision] = useState(false);
  const [savingVenue, setSavingVenue] = useState(false);
  /** UAT 2026-08-21 item 2: the venue being recorded, and its text. */
  const [venueEditing, setVenueEditing] = useState<DriveSummary | null>(null);
  const [venueText, setVenueText] = useState("");
  const [venueError, setVenueError] = useState<string | null>(null);
  /** The queue could not be read — a different nothing from an empty queue. */
  const [failure, setFailure] = useState<string | null>(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);

  const load = useCallback(() => {
    // `void view.drives().then(setLoaded)` used to swallow a rejection: the
    // screen sat on "Loading drives…" and the operator could not tell a broken
    // read from a slow one, so nothing here was ever believed.
    setFailure(null);
    setReviewsFailed(false);
    void view
      .drives()
      .then(setLoaded, (cause: unknown) =>
        setFailure(describeReadFailure(cause, "The drive queue could not be read.")),
      );
    // Cleared, not left standing: a list from an earlier read, kept beside a
    // failure that says the current one is unknown, gets believed anyway.
    void view.reviews().then(setReviews, () => {
      setReviews([]);
      setReviewsFailed(true);
    });
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

  // Not `compareOldestFirst` reversed: that made an undated drive the NEWEST,
  // which with newest-first as the default would head the queue with it.
  // 2026-08-27 (Karthik): the type filter, on every list of ongoing drives.
  const typed =
    inScope === null ? null : inScope.filter((d) => matchesDriveType(d.driveType ?? null, type));
  const drives = typed === null ? null : orderDrives(typed, sort);
  const split = drives === null ? null : partitionExpired(drives, clock);

  /**
   * The chips count company visits, because that is what the list below shows:
   * a visit that raised three full-time roles is one card, so it is one count
   * (2026-10-17, same rule as the AE overview). A visit that mixes types is
   * honestly in both of those buckets.
   */
  const typeCounts =
    inScope === null
      ? undefined
      : {
          "": groupDrivesByEvent(inScope).size,
          placement: groupDrivesByEvent(inScope.filter((d) => d.driveType === "placement")).size,
          internship_convertible: groupDrivesByEvent(
            inScope.filter((d) => d.driveType === "internship_convertible"),
          ).size,
          internship: groupDrivesByEvent(inScope.filter((d) => d.driveType === "internship")).size,
        };

  /** Q5 (2026-08-21): the venue is the Central CPC's to record — nobody else's. */
  const mayRecordVenue = view.updateVenue !== undefined && canEditDriveVenue(role);

  function openVenue(drive: DriveSummary) {
    setVenueText(drive.venue ?? "");
    setVenueError(null);
    setVenueEditing(drive);
  }

  async function saveVenue() {
    if (venueEditing === null || view.updateVenue === undefined || savingVenue) return;
    if (venueText.trim() === "") {
      setVenueError("Type the venue — an empty venue is “not yet confirmed”, not a venue.");
      return;
    }
    setSavingVenue(true);
    try {
      await view.updateVenue(venueEditing.driveId, venueText.trim());
      setVenueEditing(null);
      setVenueText("");
      setVenueError(null);
      load();
    } catch (cause) {
      setVenueError(cause instanceof Error ? cause.message : "Could not save the venue.");
    } finally {
      setSavingVenue(false);
    }
  }

  function openDecision(drive: DriveSummary, kind: "approve" | "reject") {
    // UAT 2026-08-27: a cap-only internship (0056) has no CTC, and asking the
    // strict rule to classify nothing threw — here, inside the click.
    setCategory(
      requiredOfferCategoryFor(drive.driveType ?? null) ??
        suggestOfferCategory(drive.ctcMaxLpa ?? drive.ctcMinLpa),
    );
    setReason("");
    setDecisionError(null);
    setDeciding({ drive, kind });
  }

  async function confirmDecision() {
    if (deciding === null || decide === undefined || savingDecision) return;
    const intent: PifDecision =
      deciding.kind === "approve"
        ? { decision: "approve", offerCategory: category }
        : { decision: "reject", reason: reason.trim() };

    // The same rule the repository and the database enforce — asked here so
    // the answer arrives without a round trip, never instead of them.
    const check = decidePif("submitted", intent, deciding.drive.driveType ?? null);
    if (!check.ok) {
      setDecisionError(check.error);
      return;
    }

    setSavingDecision(true);
    try {
      await decide(deciding.drive.driveId, "submitted", intent, deciding.drive.driveType ?? null);
      setDeciding(null);
      load();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "Could not save the decision.");
    } finally {
      setSavingDecision(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={scope?.title ?? "Drive cockpit"}
        subtitle={scope?.subtitle ?? "Every drive, and what it is waiting for."}
      />

      {reviewsFailed && (
        <p role="alert" className="mb-6 rounded-card bg-danger-50 p-4 text-sm text-danger-700">
          The absence reviews could not be read. That is not the same as nobody needing one.
        </p>
      )}

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
                <StudentIdentity
                  name={review.studentName}
                  rollNumber={review.rollNumber}
                  college={review.college}
                  studentId={review.studentId}
                  detail={`${review.absences} absences`}
                />
                <Badge tone="warning">Needs review</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {failure !== null ? (
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger-700">
            {failure}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Nothing is listed under it on purpose — a queue that arrived in parts is a queue that
            does not add up.
          </p>
          <Button variant="secondary" className="mt-3" onClick={load}>
            Try again
          </Button>
        </Card>
      ) : drives === null || split === null ? (
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
          {/* 2026-08-27 (Karthik): the type filter, above the list it filters. */}
          <DriveTypeFilter
            value={type}
            onChange={setType}
            {...(typeCounts === undefined ? {} : { counts: typeCounts })}
          />

          {/* G1b (UAT 2026-08-20) put the order in the reader's hands; since
              2026-08-26 it starts at newest first, like every other list. */}
          <div className="mb-3 flex justify-end">
            <DriveSort value={sort} onChange={setSort} />
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
            <Accordion className="mt-4">
              <AccordionItem value="expired">
                <AccordionTrigger className="py-3 text-sm font-medium text-ink-500">
                  {/* The list beneath counts company VISITS — DriveList folds a
                      visit's roles into one card — so this number does too, or it
                      promises more cards than the section holds. */}
                  Expired — application deadline passed ({groupDrivesByEvent(split.expired).size})
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <DriveList
                    drives={split.expired}
                    now={clock}
                    mayPublish={mayPublish}
                    mayShortlist={mayShortlist}
                    onDecide={decide === undefined ? null : openDecision}
                    onEditVenue={mayRecordVenue ? openVenue : null}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
              <Button isLoading={savingVenue} onClick={() => void saveVenue()}>
                Save venue
              </Button>
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
                  value={category ?? ""}
                  onChange={(e) => setCategory(e.target.value as OfferCategory)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                >
                  <option value="" disabled>
                    Choose a category…
                  </option>
                  {offerCategoriesFor(deciding.drive.driveType ?? null).map((c) => (
                    <option key={c} value={c}>
                      {offerCategoryLabel(c)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-warning">
                  {category === null
                    ? "No CTC on this PIF, so nothing is suggested — choose the category. This cannot be changed later."
                    : "Suggested from the CTC. This cannot be changed later."}
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
              <Button isLoading={savingDecision} onClick={() => void confirmDecision()}>
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
interface RowProps {
  readonly now: Date;
  readonly mayPublish: boolean;
  readonly mayShortlist: boolean;
  readonly onDecide: ((drive: DriveSummary, kind: "approve" | "reject") => void) | null;
  /** UAT 2026-08-21 item 2 — wired for the Central CPC alone (answer Q5). */
  readonly onEditVenue: ((drive: DriveSummary) => void) | null;
}

/**
 * 2026-10-16 (UAT): "same company shows as two" — two roles raised for one
 * visit are ONE event, and this queue is cleared event by event. A legacy
 * drive with no parent is an event of exactly one role and keeps the row it
 * always had; more than one role folds into an accordion whose header counts
 * the visit.
 */
function DriveList({ drives, ...props }: { drives: readonly DriveSummary[] } & RowProps) {
  const events = [...groupDrivesByEvent(drives).values()];

  return (
    <Card>
      <ul className="divide-y divide-neutral-200">
        {events.map((roles) => {
          const head = roles[0];
          if (head === undefined) return null;
          return (
            <li key={head.driveId} className="p-4">
              {roles.length === 1 ? (
                <DriveRow drive={head} {...props} />
              ) : (
                <EventGroup head={head} roles={roles} {...props} />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * One role's facts and one role's actions — the row this card used to be.
 * `nested` is the same row inside an event accordion, where the trigger has
 * already said the company, the role, the money and the status.
 */
function DriveRow({
  drive,
  now,
  mayPublish,
  mayShortlist,
  onDecide,
  onEditVenue,
  nested = false,
}: { drive: DriveSummary; nested?: boolean } & RowProps) {
  const raised = describeRaisedOn(drive.createdAt);
  const pendingDays = daysPending(drive.createdAt, now);
  const unpublished =
    drive.status === "draft" || drive.status === "submitted" || drive.status === "approved";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!nested && (
            <>
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
                {drive.companyName}
                {/* 2026-08-27: the type, on every drive summary. */}
                <Badge tone={driveTypeTone(drive.driveType ?? null)}>
                  {driveTypeLabel(drive.driveType ?? null)}
                </Badge>
              </p>
              <p className="text-sm text-ink-500">
                {[
                  drive.roleTitle ?? "Role not set",
                  describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa),
                  // An internship has no CTC — the stipend is the number.
                  describeStipendRange(
                    drive.stipendMinMonthly ?? null,
                    drive.stipendMaxMonthly ?? null,
                  ),
                  `${drive.applicationCount} applicants`,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ")}
              </p>
              {/* G1a: the age of the submission, stated on the card. */}
              {raised !== null && <p className="mt-0.5 text-xs text-ink-500">{raised}</p>}
            </>
          )}
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
          {/* Who the drive is for, on the card — a CPC member should
              not have to open the record to learn it. Absent (older
              fixtures) stays silent; empty means every campus. */}
          {drive.campuses !== undefined && (
            <p className="mt-0.5 text-xs text-ink-500">
              {drive.campuses.length === 0
                ? "Open to every campus"
                : `Open to: ${drive.campuses.join(", ")}`}
            </p>
          )}
        </div>
        {!nested && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[drive.status]}>{label(drive.status)}</Badge>
            {drive.onHold && <Badge tone="warning">On hold</Badge>}
            {/* G1a: flagged only while it awaits someone's action. */}
            {unpublished && isPendingTooLong(drive.createdAt, now) && (
              <Badge tone="warning">Pending {pendingDays} days</Badge>
            )}
          </div>
        )}
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

        {/* C3 (2026-08-21): the completion dialog lives on the rounds
            screen; the card only takes the coordinator there. */}
        {mayShortlist && drive.status === "in_rounds" && (
          <Link
            to={`/central/results?drive=${drive.driveId}`}
            className="font-medium text-brand-600 hover:underline"
          >
            Complete drive…
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * 2026-10-16 (UAT): the whole visit on one card. Each role keeps the row it
 * had — approval, publishing and the venue are decided per role — but the
 * queue is read and cleared event by event, so the header answers the questions
 * a list of same-company cards could not: how many roles, how many students,
 * and how many of them are waiting on the reader.
 */
function EventGroup({
  head,
  roles,
  ...props
}: { head: DriveSummary; roles: readonly DriveSummary[] } & RowProps) {
  const raised = describeRaisedOn(head.createdAt);
  const students = roles.flatMap((role) => [...(role.applicantStudentIds ?? [])]);
  // The ids are the only way to de-duplicate a student who applied to two of
  // the visit's roles; without them the honest statement is a summed head-count.
  const applicants =
    students.length === 0
      ? roles.reduce((sum, role) => sum + role.applicationCount, 0)
      : countDistinctApplicants(students.map((studentId) => ({ studentId })));
  const awaiting = roles.filter((role) => awaitsReader(role, props));

  const types = new Set(roles.map((role) => role.driveType ?? null));
  const [singleType] = types;
  const uniform = types.size === 1 && singleType !== undefined;

  const statuses = [...countBy(roles, (role) => role.status)];
  const held = roles.filter((role) => role.onHold).length;
  const stale = roles.filter(
    (role) =>
      (role.status === "draft" || role.status === "submitted" || role.status === "approved") &&
      isPendingTooLong(role.createdAt, props.now),
  ).length;

  // Opened for the reader rather than making them hunt: the roles awaiting an
  // action are the reason the card exists.
  const openByDefault = awaiting.map((role) => role.driveId);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
            {head.companyName}
            <Badge tone={uniform ? driveTypeTone(singleType ?? null) : "neutral"}>
              {uniform ? driveTypeLabel(singleType ?? null) : "Mixed types"}
            </Badge>
          </p>
          <p className="text-sm text-ink-500">
            {roles.length} roles · {applicants} applicants
            {awaiting.length > 0 && ` · ${awaiting.length} awaiting you`}
          </p>
          {raised !== null && <p className="mt-0.5 text-xs text-ink-500">{raised}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Only when every role stands where the visit does: one badge that
              reads as "all three of these". A visit that mixes would only be
              repeating the badges each role already wears below. */}
          {statuses.length === 1 && (
            <Badge tone={STATUS_TONE[statuses[0]?.[0] ?? "draft"]}>
              {label(statuses[0]?.[0] ?? "draft")}
              {(statuses[0]?.[1] ?? 0) > 1 && ` ×${statuses[0]?.[1]}`}
            </Badge>
          )}
          {held > 0 && <Badge tone="warning">{held} on hold</Badge>}
          {stale > 0 && <Badge tone="warning">Pending too long ({stale})</Badge>}
        </div>
      </div>

      <Accordion multiple className="mt-3" defaultValue={openByDefault}>
        {roles.map((drive) => {
          const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);
          const stipend = describeStipendRange(
            drive.stipendMinMonthly ?? null,
            drive.stipendMaxMonthly ?? null,
          );
          return (
            <AccordionItem key={drive.driveId} value={drive.driveId}>
              <AccordionTrigger className="py-3">
                <span className="font-medium text-ink-900">
                  {drive.roleTitle ?? "Role not set"}
                </span>
                {ctc !== null && <span>{ctc}</span>}
                {stipend !== null && <span>{stipend}</span>}
                <span>{drive.applicationCount} applicants</span>
                <Badge tone={STATUS_TONE[drive.status]}>{label(drive.status)}</Badge>
                {drive.onHold && <Badge tone="warning">On hold</Badge>}
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <DriveRow nested drive={drive} {...props} />
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

/**
 * "Awaiting you" counts only what blocks the visit: the Delivery Head's
 * decision and the Central CPC's publishing. Shortlisting and results are
 * links, not demands — counting them would make every card urgent.
 */
function awaitsReader(
  drive: DriveSummary,
  props: Pick<RowProps, "mayPublish" | "onDecide">,
): boolean {
  if (props.onDecide !== null && drive.status === "submitted") return true;
  return props.mayPublish && (drive.status === "approved" || drive.status === "draft");
}

function countBy<T, K extends string>(
  rows: readonly T[],
  key: (row: T) => K,
): readonly (readonly [K, number])[] {
  const counts = new Map<K, number>();
  for (const row of rows) {
    const k = key(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts];
}
