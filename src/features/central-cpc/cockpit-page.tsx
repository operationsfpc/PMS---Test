import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/alert-dialog";
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
  ButtonLink,
  Card,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
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
        <div className="rounded-lg border border-dashed border-line p-6 text-center">
          <p className="text-sm font-medium text-ink-700">{scope?.empty ?? "No drives yet."}</p>
          <p className="mt-1 text-sm text-ink-500">
            An Account Executive raises a PIF, the Delivery Head approves it, and it appears here.
          </p>
        </div>
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
            <div className="rounded-lg border border-dashed border-line p-6 text-center">
              <p className="text-sm font-medium text-ink-700">
                {scope?.empty ?? "Nothing needs action right now."}
              </p>
              {/* The folded section below is the only other place a drive can
                  be; saying so stops an empty queue reading as a lost one. */}
              {split.expired.length > 0 && (
                <p className="mt-1 text-sm text-ink-500">
                  The drives past their application deadline are folded underneath.
                </p>
              )}
            </div>
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

      {/* UAT 2026-08-21 item 2: recording the confirmed venue. It shares the
          drawer the rosters open in, because a hand-rolled overlay closes on
          nothing but its own Cancel — no Escape, no focus in, no focus back
          out to the button that asked for it. */}
      {venueEditing !== null && (
        <Sheet
          open
          onOpenChange={(next) => {
            if (!next) setVenueEditing(null);
          }}
        >
          <SheetContent side="right" size="sm">
            <SheetHeader>
              <SheetTitle>Venue — {venueEditing.companyName}</SheetTitle>
              <SheetDescription>
                As confirmed by the company. Students see it on the drive card.
              </SheetDescription>
            </SheetHeader>

            {venueError !== null && (
              <p role="alert" className="mb-2 text-sm text-danger-700">
                {venueError}
              </p>
            )}

            <div>
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

            <SheetFooter>
              <Button variant="secondary" onClick={() => setVenueEditing(null)}>
                Cancel
              </Button>
              <Button isLoading={savingVenue} onClick={() => void saveVenue()}>
                Save venue
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      {/* G1c: the decision, from the list — same rules as the approval queue. */}
      {deciding !== null && (
        <AlertDialog
          open
          onOpenChange={(next) => {
            if (!next) setDeciding(null);
          }}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deciding.kind === "approve" ? "Approve" : "Reject"} {deciding.drive.companyName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deciding.kind === "approve"
                  ? "Approving lets the coordinators publish it to their students."
                  : "Rejection is final — the PIF cannot be edited or resubmitted."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {decisionError !== null && (
              <p role="alert" className="mb-2 text-sm text-danger-700">
                {decisionError}
              </p>
            )}

            {deciding.kind === "approve" ? (
              <div>
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
                <p className="mt-1 text-xs text-gold-700">
                  {category === null
                    ? "No CTC on this PIF, so nothing is suggested — choose the category. This cannot be changed later."
                    : "Suggested from the CTC. This cannot be changed later."}
                </p>
              </div>
            ) : (
              <div>
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
                <p className="mt-1 text-xs text-ink-500">Required.</p>
              </div>
            )}

            {/* Not AlertDialogAction: it closes whatever the write did, and a
                refusal has to stay on screen with the reason beside it. */}
            <AlertDialogFooter>
              <Button variant="secondary" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button
                variant={deciding.kind === "approve" ? "primary" : "danger"}
                isLoading={savingDecision}
                onClick={() => void confirmDecision()}
              >
                {deciding.kind === "approve" ? "Confirm — approve" : "Confirm — reject permanently"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
 * drive with no parent is an event of exactly one role.
 *
 * 2026-10-18 gives this queue the card the coordinator's screens already had.
 * Until now it was one `Card` of divided rows, which is exactly why "Yet to
 * publish" read as a generation behind the Live and Completed lists beside it:
 * the visit is the card, the card states it once, and the roles sit under it.
 */
function DriveList({ drives, ...props }: { drives: readonly DriveSummary[] } & RowProps) {
  const events = [...groupDrivesByEvent(drives).values()];

  return (
    <ul className="space-y-6">
      {events.map((roles) => {
        const head = roles[0];
        if (head === undefined) return null;
        return (
          <li key={head.driveId}>
            <VisitCard roles={roles} {...props} />
          </li>
        );
      })}
    </ul>
  );
}

/** A drive awaiting someone's decision — publishing is the reader's own job. */
const isUnpublished = (status: DriveStatus) =>
  status === "draft" || status === "submitted" || status === "approved";

/**
 * How many STUDENTS a visit holds, not how many applications.
 *
 * The ids are the only way to de-duplicate a student who applied to two of the
 * visit's roles; where a read brings none, the honest figure is the summed
 * head-count, and mixing the two measures inside one number is worse than
 * saying which one it is.
 */
function countVisitApplicants(roles: readonly DriveSummary[]): number {
  const students = roles.flatMap((role) => [...(role.applicantStudentIds ?? [])]);
  return students.length === 0
    ? roles.reduce((sum, role) => sum + role.applicationCount, 0)
    : countDistinctApplicants(students.map((studentId) => ({ studentId })));
}

/** Role, money, size: what tells two roles of one visit apart. */
function roleFacts(drive: DriveSummary): string {
  return [
    drive.roleTitle ?? "Role not set",
    describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa),
    // An internship has no CTC — the stipend is the number.
    describeStipendRange(drive.stipendMinMonthly ?? null, drive.stipendMaxMonthly ?? null),
    `${drive.applicationCount} applicants`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * One company visit, one card: the band across the top is the visit — named
 * once, counted once, aged once — and everything below belongs to a role.
 *
 * A visit that raised several roles folds them into an accordion opened on the
 * roles that are waiting on the reader, because that is why the card exists.
 */
function VisitCard({ roles, ...props }: { roles: readonly DriveSummary[] } & RowProps) {
  const head = roles[0];
  if (head === undefined) return null;

  const isVisit = roles.length > 1;
  const raised = describeRaisedOn(head.createdAt);

  // The type said once for the visit. A visit mixing an internship with a
  // full-time role cannot pick one at random, so it says "Mixed types".
  const types = new Set(roles.map((role) => role.driveType ?? null));
  const [singleType] = types;
  const mixed = types.size > 1;

  const singleBadges = () => {
    const stale = isUnpublished(head.status) && isPendingTooLong(head.createdAt, props.now);
    return (
      <>
        <Badge tone={STATUS_TONE[head.status]}>{label(head.status)}</Badge>
        {head.onHold && <Badge tone="warning">On hold</Badge>}
        {/* G1a: the age of a submission, flagged only while it waits. */}
        {stale && (
          <Badge tone="warning">Pending {daysPending(head.createdAt, props.now)} days</Badge>
        )}
      </>
    );
  };

  // Only when every role stands where the visit does: one badge that reads as
  // "all three of these". A visit that mixes would only repeat the badges each
  // role already wears on its own row.
  const uniform = new Set(roles.map((role) => role.status));
  const held = roles.filter((role) => role.onHold).length;
  const staleRoles = roles.filter(
    (role) => isUnpublished(role.status) && isPendingTooLong(role.createdAt, props.now),
  ).length;
  const awaiting = roles.filter((role) => awaitsReader(role, props));

  // The role count is said once, as the badge beside the company; the line
  // under it carries only what the badge cannot.
  const meta = isVisit
    ? [
        `${countVisitApplicants(roles)} applicants`,
        ...(awaiting.length > 0 ? [`${awaiting.length} awaiting you`] : []),
      ].join(" · ")
    : roleFacts(head);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-muted/30 p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-heading text-base font-bold text-ink-900">
            {head.companyName}
            <Badge tone={mixed ? "neutral" : driveTypeTone(singleType ?? null)}>
              {mixed ? "Mixed types" : driveTypeLabel(singleType ?? null)}
            </Badge>
            {isVisit && <Badge tone="brand">{roles.length} roles</Badge>}
          </p>
          <p className="mt-1 text-sm text-ink-500">{meta}</p>
          {raised !== null && <p className="mt-0.5 text-xs text-ink-500">{raised}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isVisit ? (
            <>
              {uniform.size === 1 && (
                <Badge tone={STATUS_TONE[[...uniform][0] ?? "draft"]}>
                  {label([...uniform][0] ?? "draft")}
                  {roles.length > 1 && ` ×${roles.length}`}
                </Badge>
              )}
              {held > 0 && <Badge tone="warning">{held} on hold</Badge>}
              {staleRoles > 0 && <Badge tone="warning">Pending too long ({staleRoles})</Badge>}
            </>
          ) : (
            singleBadges()
          )}
        </div>
      </div>

      {isVisit ? (
        <div className="p-4">
          {/* Opened for the reader rather than making them hunt: the roles
              awaiting an action are the reason the card exists. */}
          <Accordion multiple className="mt-1" defaultValue={awaiting.map((r) => r.driveId)}>
            {roles.map((drive) => (
              <AccordionItem key={drive.driveId} value={drive.driveId}>
                <AccordionTrigger className="py-3">
                  <span className="font-medium text-ink-900">
                    {drive.roleTitle ?? "Role not set"}
                  </span>
                  {" · "}
                  {mixed && drive.driveType !== undefined && drive.driveType !== null && (
                    <Badge tone={driveTypeTone(drive.driveType)}>
                      {driveTypeLabel(drive.driveType)}
                      {" · "}
                    </Badge>
                  )}
                  <span>{drive.applicationCount} applicants</span>
                  {" · "}
                  <Badge tone={STATUS_TONE[drive.status]}>{label(drive.status)}</Badge>
                  {drive.onHold && (
                    <>
                      {" · "}
                      <Badge tone="warning">On hold</Badge>
                    </>
                  )}
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-xs text-ink-500">{roleFacts(drive)}</p>
                  <RoleBlock drive={drive} {...props} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ) : (
        <div className="p-4">
          <RoleBlock drive={head} {...props} />
        </div>
      )}
    </Card>
  );
}

/**
 * What one role still has to say after its visit has been named: where it
 * happens, who it is open to, and the actions the reader may take on it.
 */
function RoleBlock({
  drive,
  mayPublish,
  mayShortlist,
  onDecide,
  onEditVenue,
}: RowProps & { drive: DriveSummary }) {
  // Who the drive is for, on the card — a CPC member should not have to open
  // the record to learn it. Absent (older fixtures) stays silent; empty means
  // every campus.
  const venue = describeDriveVenue(
    (drive.driveMode ?? null) as Parameters<typeof describeDriveVenue>[0],
    drive.venue ?? null,
  );

  return (
    <div>
      {venue !== null && <p className="mt-1 text-xs text-ink-500">Venue: {venue}</p>}
      {drive.campuses !== undefined && (
        <p className="mt-0.5 text-xs text-ink-500">
          {drive.campuses.length === 0
            ? "Open to every campus"
            : `Open to: ${drive.campuses.join(", ")}`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* B2 (UAT 2026-08-19): every card opens the record page, whatever its
            status. It is the card's ONE `View` — the rest of these name the
            thing they do, because two controls that both read "View" leave the
            reader to guess which is the person. */}
        <ButtonLink
          size="sm"
          to={`/drives/${drive.driveId}`}
          aria-label={`View ${drive.companyName} — ${drive.roleTitle ?? "role not set"}`}
        >
          View
        </ButtonLink>

        {/* UAT 2026-08-21 item 2: the venue stays editable after submission —
            the company confirms it late, the CPC records it here. */}
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
          <ButtonLink size="sm" variant="secondary" to={`/central/publish?drive=${drive.driveId}`}>
            Publish
          </ButtonLink>
        )}

        {mayShortlist &&
          (drive.status === "live" ||
            drive.status === "applications_closed" ||
            drive.status === "in_rounds") && (
            <ButtonLink
              size="sm"
              variant="secondary"
              to={`/central/shortlisting?drive=${drive.driveId}`}
            >
              Shortlist
            </ButtonLink>
          )}

        {drive.rounds.map((round) => (
          <ButtonLink
            key={round.roundId}
            size="sm"
            variant="ghost"
            to={`/central/results?drive=${drive.driveId}`}
          >
            {round.sequence}. {round.name}
          </ButtonLink>
        ))}

        {(drive.status === "in_rounds" || drive.status === "completed") && (
          <ButtonLink size="sm" variant="secondary" to={`/central/offers?drive=${drive.driveId}`}>
            Offers
          </ButtonLink>
        )}

        {/* C3 (2026-08-21): the completion dialog lives on the rounds screen;
            the card only takes the coordinator there. */}
        {mayShortlist && drive.status === "in_rounds" && (
          <ButtonLink size="sm" variant="secondary" to={`/central/results?drive=${drive.driveId}`}>
            Complete
          </ButtonLink>
        )}
      </div>
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
