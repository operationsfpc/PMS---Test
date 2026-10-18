import { DriveDateFilter } from "@components/drive-date-filter";
import { DriveSearch, NoDriveMatches } from "@components/drive-search";
import { DriveSort } from "@components/drive-sort";
import { DriveTypeFilter } from "@components/drive-type-filter";
import { ErrorPanel } from "@components/error-panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  PageHeader,
  StatCard,
} from "@components/ui";
import { VisitPane, type VisitPaneRole } from "@components/visit-pane";
import { groupByVisitKey, isStandaloneVisit, visitKey } from "@domain/company-drive";
import { describeCtcRange } from "@domain/ctc";
import {
  type DriveOrder,
  describeVisitDay,
  orderDrives,
  partitionExpired,
  visitDayInParentheses,
} from "@domain/drive-aging";
import { applicationWindow } from "@domain/drive-analytics";
import { type DateRangeFilterCriteria, filterDrivesByDateRange } from "@domain/drive-date-filter";
import {
  canShortlistFromPortfolio,
  canViewDriveApplicants,
  type DriveRole,
  driveProgress,
  involvementIn,
  searchDrives,
  summariseFunnel,
} from "@domain/drive-portfolio";
import {
  DRIVE_TYPE_FILTERS,
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { describeDriveFreeze } from "@domain/drive-working";
import { type ApplicantRound, applicationProgress } from "@domain/student-progress";
import type { AppRole, DriveStatus, DriveType } from "@domain/types";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

/** Grouped portfolio drives by company event for multi-role display. */
interface PortfolioEvent {
  readonly eventId: string;
  readonly companyName: string;
  readonly tentativeDate: string | null;
  readonly driveMode: string | null;
  readonly venue: string | null;
  readonly roles: readonly PortfolioDrive[];
  readonly totalFunnel: {
    readonly applied: number;
    readonly shortlisted: number;
    readonly inRounds: number;
    readonly offers: number;
    readonly notSelected: number;
  };
}

/**
 * Why this visit cannot take one more role, or null when it can.
 *
 * A visit is finished with when EVERY role under it is. Raising a fifth role
 * onto a Zoho visit whose four roles are all completed puts a job posting on a
 * drive nobody is hiring through any more, and the AE used to be offered it
 * anyway — the same rule the offer and shortlist screens read, in the same
 * words.
 */
function visitRoleFreeze(event: PortfolioEvent): string | null {
  const sentences = event.roles.map((role) => describeDriveFreeze("roles", role.status));
  return sentences.length > 0 && sentences.every((sentence) => sentence !== null)
    ? (sentences[0] ?? null)
    : null;
}

/** Groups portfolio drives by their parent company event. */
function groupPortfolioByEvent(drives: readonly PortfolioDrive[]): PortfolioEvent[] {
  const groups = groupByVisitKey(drives, (drive) => visitKey(drive.companyDriveId, drive.driveId));

  return Array.from(groups.entries()).map(([key, roles]) => {
    const first = roles[0];
    if (!first) throw new Error("Group has no roles");
    const allApplicants = roles.flatMap((r) => r.applicants);
    const funnel = summariseFunnel(allApplicants);

    return {
      eventId: key,
      companyName: first.companyName,
      tentativeDate: first.tentativeDate ?? null,
      driveMode: null,
      venue: null,
      roles,
      totalFunnel: funnel,
    };
  });
}

/** The type a visit runs on. One visit usually means one type, so the badge is
 * said once on the visit; only a visit that genuinely mixes types puts a badge
 * on each role instead. */
function visitType(roles: readonly PortfolioDrive[]) {
  const types = new Set(roles.map((role) => role.driveType));
  const [single] = types;
  return { mixed: types.size > 1, single: types.size === 1 ? (single ?? null) : null };
}

/** The visit whose applicants the side pane is listing, and the role it opens on. */
interface OpenVisit {
  readonly company: string;
  readonly when: string | null;
  readonly roles: readonly PortfolioDrive[];
  readonly activeId: string;
}

/** Pane headers read as a sentence under the company, so the date is spelled once here. */
const visitDay = (iso: string | null) => describeVisitDay(iso) ?? undefined;

export interface PortfolioApplicant {
  readonly applicationId: string;
  /** The student behind the application, so the AE can open their record. */
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly campus: string;
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
  readonly rounds: readonly ApplicantRound[];
}

export interface PortfolioDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly status: DriveStatus;
  readonly onHold: boolean;
  /** 2026-08-27: what the drive IS — filtered on, and tagged on every card. */
  readonly driveType: DriveType | null;
  /** G5b (UAT 2026-08-20): role + CTC is what tells two same-company drives apart. */
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  readonly createdBy: string | null;
  readonly approvedBy: string | null;
  readonly publishedBy: string | null;
  readonly totalRounds: number;
  readonly roundsDecided: number;
  /** When the drive was raised. The list is ordered by it (2026-08-26). */
  readonly createdAt: string | null;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  readonly tentativeDate?: string | null;
  readonly openings?: number | null;
  readonly companyDriveId?: string | null;
  readonly applicants: readonly PortfolioApplicant[];
}

export interface PortfolioView {
  drives(): Promise<readonly PortfolioDrive[]>;
}

/**
 * The three chips - All my drives / Raised by me / Approved by me - are GONE
 * (2026-08-18: "just remove the three select options at the top of the page").
 *
 * They filtered a list to itself: for an Account Executive every drive is one
 * they raised, and for a Delivery Head every drive is one they approved. What
 * replaced them is a search box, which answers the question a list of drives
 * actually raises. `involvementIn` stays - it still draws the "Raised by you"
 * badges, which say something the chips only repeated.
 */

const ROLE_LABEL: Readonly<Record<DriveRole, string>> = {
  raised: "Raised by you",
  approved: "Approved by you",
  published: "Published by you",
};

const STAGE_TONE = {
  applied: "neutral",
  in_process: "warning",
  selected: "success",
  not_selected: "neutral",
} as const;

/**
 * The drives one person owns, and what has become of them.
 *
 * Requested 2026-08-04 for the Delivery Head and the Account Executive:
 * approving a PIF used to be the last a Delivery Head saw of it, and an AE
 * could raise a drive and never learn whether anyone applied.
 *
 * One screen serves both roles. Which drives they can see at all is RLS's
 * decision, not this component's - an AE is shown only the drives they raised
 * because the database will return nothing else. The filter here is a
 * convenience on top of that, never a substitute for it.
 */
export function DrivePortfolioPage({
  view,
  profileId,
  title,
  role,
  statuses,
  /** Passed in, never read from the browser — see src/domain/drive-analytics. */
  now = new Date(),
}: {
  view: PortfolioView;
  profileId: string;
  title: string;
  /** Decides shortlisting access, and nothing else (F15). */
  role: AppRole;
  /**
   * Which statuses this tab is for (2026-08-18). Absent means every drive -
   * `/my-drives` is one person's whole portfolio and always has been.
   *
   * Given, it is the tab's whole meaning: a page headed "Live" must not list a
   * drive that is approved and not yet published, because that is precisely
   * what "Yet to publish" is for.
   */
  statuses?: readonly DriveStatus[];
  now?: Date;
}) {
  // F15: the Central CPC gets the AE's screen "with shortlisting access". Who
  // that is, is the domain's answer - an AE must not choose which candidates
  // their own recruiter sees.
  const mayShortlist = canShortlistFromPortfolio(role);
  /**
   * 2026-08-17 (Karthik): the company-facing applicant list on approved and
   * published drives is "strictly restricted to the Account Executive". The
   * funnel counts stay for everyone - a coordinator still needs to know a
   * drive has two applicants - but the roll of names does not.
   */
  const mayViewApplicants = canViewDriveApplicants(role);
  const [drives, setDrives] = useState<readonly PortfolioDrive[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumping this re-runs the one read below. The failure card used to only
  // tell the reader to refresh the whole page; a retry is a smaller ask.
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  /**
   * The applicant roll is a read of one company visit, so it opens in the
   * shared side pane rather than expanding inside the card: the card already
   * carries the funnel, and a roll of names pushed everything below it down.
   */
  const [openVisit, setOpenVisit] = useState<OpenVisit | null>(null);
  /**
   * 2026-08-26 (Karthik): newest first, here and everywhere else. A
   * coordinator opening Live is looking for what just happened; the
   * oldest-first order G1b gave the publish QUEUE is for clearing a backlog,
   * which is not what this list is.
   */
  const [order, setOrder] = useState<DriveOrder>("newest");
  const [type, setType] = useState<DriveTypeFilterValue>("");
  const [dateCriteria, setDateCriteria] = useState<DateRangeFilterCriteria>({
    dimension: "created_at",
    preset: "all",
    startDate: null,
    endDate: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let live = true;
    view
      .drives()
      .then((next) => {
        if (live) setDrives(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [view, attempt]);

  /**
   * The tab first, then the search. The status group is what the page IS; the
   * search is what the reader is looking for inside it, and searching outside
   * the tab would return a drive the heading says is not here.
   */
  const inScope = useMemo(
    () =>
      statuses === undefined
        ? (drives ?? [])
        : (drives ?? []).filter((drive) => statuses.includes(drive.status)),
    [drives, statuses],
  );

  const dateFiltered = useMemo(
    () => filterDrivesByDateRange(inScope, dateCriteria),
    [inScope, dateCriteria],
  );

  /**
   * 2026-08-27 (Karthik): the type filter. It sits between the tab and the
   * search for the same reason the tab does: it narrows WHICH drives, while
   * the search narrows which of those you are looking for.
   */
  const visible = useMemo(
    () =>
      orderDrives(
        searchDrives(
          dateFiltered.filter((drive) => matchesDriveType(drive.driveType, type)),
          query,
        ),
        order,
      ),
    [dateFiltered, query, order, type],
  );

  /** What each chip is worth, counted before the search narrows anything. */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { "": dateFiltered.length };
    for (const option of DRIVE_TYPE_FILTERS) {
      if (option.value !== "") {
        counts[option.value] = dateFiltered.filter((d) => d.driveType === option.value).length;
      }
    }
    return counts;
  }, [dateFiltered]);

  /**
   * G5c / G1d (UAT 2026-08-20, answer 1a): past-deadline drives collapse into
   * an "Expired" section so the working list stays on what needs action.
   */
  const { active: activeDrives, expired: expiredDrives } = useMemo(
    () => partitionExpired(visible, now),
    [visible, now],
  );

  /** Group drives by company event for multi-role display. */
  const activeEvents = useMemo(() => groupPortfolioByEvent(activeDrives), [activeDrives]);
  const expiredEvents = useMemo(() => groupPortfolioByEvent(expiredDrives), [expiredDrives]);

  if (failed) {
    return (
      <ErrorPanel
        onRetry={() => {
          setFailed(false);
          setAttempt((a) => a + 1);
        }}
      >
        We could not load your drives.
      </ErrorPanel>
    );
  }

  if (drives === null) {
    return (
      <p role="status" className="text-sm text-ink-500">
        Loading your drives…
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title={title}
        /* Publishing became the Central CPC's alone, so a blurb telling the AE
           and the Delivery Head they publish was describing a power neither
           has. Karthik's words, 2026-08-17. */
        subtitle="Every drive I raise or approve — and what has become of it."
      />

      {inScope.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            {statuses === undefined
              ? "No drives yet. A drive appears here as soon as you raise or approve one."
              : "No drives in this list yet."}
          </p>
        </Card>
      ) : (
        <>
          <DriveDateFilter
            criteria={dateCriteria}
            onChange={setDateCriteria}
            filteredDrives={dateFiltered}
            allDrivesCount={inScope.length}
            showAnalytics={true}
          />

          <DriveSearch value={query} onChange={setQuery} />

          <DriveTypeFilter value={type} onChange={setType} counts={typeCounts} />

          <div className="mb-3 flex justify-end">
            <DriveSort value={order} onChange={setOrder} />
          </div>

          {visible.length === 0 ? (
            <Card className="p-6">
              <NoDriveMatches
                query={query}
                {...(type === "" ? {} : { typeLabel: driveTypeLabel(type) })}
              />
            </Card>
          ) : (
            <>
              <ul className="flex flex-col gap-4">
                {activeEvents.map((event) => renderEvent(event))}
              </ul>

              {expiredEvents.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink-500">
                    Expired — application deadline passed ({expiredEvents.length})
                  </summary>
                  <ul className="mt-3 flex flex-col gap-4">
                    {expiredEvents.map((event) => renderEvent(event))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}

      {/* Gated on the rule as well as on the pane being open: a pane left open
          must not keep showing the roll to a role that may not read it. */}
      {openVisit !== null && mayViewApplicants && (
        <VisitPane
          open
          onClose={() => setOpenVisit(null)}
          company={openVisit.company}
          description={visitDay(openVisit.when)}
          roles={paneRoles(openVisit)}
          activeId={openVisit.activeId}
        />
      )}
    </div>
  );

  /** One role's roll of names, as the pane reads it. */
  function applicantList(drive: PortfolioDrive) {
    if (drive.applicants.length === 0) {
      return (
        <p className="text-sm text-ink-700">
          Nobody has applied yet. Applicants appear the moment they apply.
        </p>
      );
    }

    return (
      <ul className="divide-y divide-line">
        {drive.applicants.map((applicant) => {
          const stage = applicationProgress({
            rounds: applicant.rounds,
            hasOffer: applicant.hasOffer,
          });

          return (
            <li
              key={applicant.applicationId}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">
                  <Link to={`/students/${applicant.studentId}`} className="hover:underline">
                    {applicant.studentName}
                  </Link>
                </p>
                <p className="text-xs text-ink-500">
                  <span>Roll {applicant.rollNumber}</span> · {applicant.campus}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {applicant.shortlisted && <Badge tone="brand">Shortlisted</Badge>}
                <Badge tone={STAGE_TONE[stage.stage]}>{stage.label}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  /** The visit's roles, one tab each. A visit that runs on one type says it on
   * the card; only a mixed visit has to name the type per role. */
  function paneRoles(visit: OpenVisit): readonly VisitPaneRole[] {
    const mixed = new Set(visit.roles.map((role) => role.driveType)).size > 1;

    return visit.roles.map((role) => ({
      id: role.driveId,
      label: role.roleTitle,
      count: {
        value: role.applicants.length,
        unit: role.applicants.length === 1 ? "applicant" : "applicants",
      },
      badge: mixed ? (
        <Badge tone={driveTypeTone(role.driveType)}>{driveTypeLabel(role.driveType)}</Badge>
      ) : undefined,
      content: (
        <>
          <p className="mb-3">
            <Link
              to={`/drives/${role.driveId}`}
              className="text-xs font-semibold text-brand-700 underline underline-offset-2"
            >
              Open the drive record for {role.roleTitle}
            </Link>
          </p>
          {applicantList(role)}
        </>
      ),
    }));
  }

  function renderEvent(event: PortfolioEvent) {
    const isMultiRole = event.roles.length > 1;
    const types = visitType(event.roles);

    return (
      <li key={event.eventId}>
        <Card className="overflow-hidden">
          {/* Event Header for multi-role drives */}
          {isMultiRole && (
            <div className="border-b border-line bg-brand-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-[Raleway] text-lg font-bold text-ink-900">
                  {event.companyName}
                </h3>
                {!types.mixed && types.single !== null && (
                  <Badge tone={driveTypeTone(types.single)}>{driveTypeLabel(types.single)}</Badge>
                )}
                {types.mixed && <Badge tone="neutral">Mixed types</Badge>}
                <Badge tone="brand">{event.roles.length} roles</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-ink-600">
                {event.tentativeDate && (
                  <span>
                    📅{" "}
                    {new Date(event.tentativeDate).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <span className="font-semibold">
                  <strong>{event.totalFunnel.applied}</strong> applied
                </span>
                <span className="font-semibold">
                  <strong>{event.totalFunnel.shortlisted}</strong> shortlisted
                </span>
                <span className="font-semibold">
                  <strong>{event.totalFunnel.inRounds}</strong> in rounds
                </span>
                <span className="font-semibold">
                  <strong>{event.totalFunnel.offers}</strong> offers
                </span>
              </div>
            </div>
          )}

          {/* Each role keeps its own progress in its own open panel. The visit
              is named once above; nothing here repeats it, and no role's counts
              are summed with another's. */}
          {isMultiRole ? (
            <Accordion multiple defaultValue={event.roles.map((drive) => drive.driveId)}>
              {event.roles.map((drive) => {
                const progress = driveProgress(drive);
                const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);
                return (
                  <AccordionItem key={drive.driveId} value={drive.driveId}>
                    <AccordionTrigger className="px-4 py-3">
                      <span className="font-semibold text-ink-900">
                        {drive.roleTitle}
                        {ctc !== null && ` · ${ctc}`}
                      </span>
                      {types.mixed && (
                        <Badge tone={driveTypeTone(drive.driveType)}>
                          {driveTypeLabel(drive.driveType)}
                        </Badge>
                      )}
                      <Badge tone={progress.terminal ? "neutral" : "warning"}>
                        {progress.phase}
                      </Badge>
                    </AccordionTrigger>
                    <AccordionContent>{renderDrive(drive, true, event)}</AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          ) : (
            event.roles.map((drive) => (
              <Fragment key={drive.driveId}>{renderDrive(drive, false, event)}</Fragment>
            ))
          )}

          {/* One or the other: an offer to raise a role, or the state that
              refuses it. Both on screen at once reads as two controls. Said
              once per visit — the roles listed above each used to repeat the
              offer, so a single-role visit showed it twice on one card. */}
          {(role === "account_executive" || role === "admin") && (
            <div className="border-t border-line bg-surface-muted p-3">
              {(() => {
                const refused = visitRoleFreeze(event);
                return refused !== null ? (
                  <p className="text-xs text-ink-500">{refused} No further roles can be raised.</p>
                ) : (
                  <Link
                    to={`/ae/pif?companyName=${encodeURIComponent(event.companyName)}&companyDriveId=${
                      isStandaloneVisit(event.eventId) ? "" : event.eventId
                    }&tentativeDate=${encodeURIComponent(event.tentativeDate ?? "")}`}
                    className="inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    + Add Another Role to This Drive
                    {isMultiRole ? "" : visitDayInParentheses(event.tentativeDate)}
                  </Link>
                );
              })()}
            </div>
          )}
        </Card>
      </li>
    );
  }

  function renderDrive(drive: PortfolioDrive, nested: boolean, event: PortfolioEvent) {
    const progress = driveProgress(drive);
    const funnel = summariseFunnel(drive.applicants);
    const window = applicationWindow(
      {
        start: drive.applicationStart === null ? null : new Date(drive.applicationStart),
        end: drive.applicationEnd === null ? null : new Date(drive.applicationEnd),
      },
      now,
    );
    const hats = involvementIn(drive, profileId);
    const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);
    const closeDate =
      drive.applicationEnd === null
        ? null
        : new Date(drive.applicationEnd).toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric",
            month: "short",
            year: "numeric",
          });
    const closed =
      drive.applicationEnd !== null && new Date(drive.applicationEnd).getTime() < now.getTime();
    /** The company is never repeated next to the role. Inside a visit the header
     * already named it, so the role is what labels this panel's regions. */
    const who = nested ? drive.roleTitle : drive.companyName;

    const content = (
      <section aria-label={who} className={nested ? "p-4" : "p-5"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {!nested && (
              <>
                <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900">
                  <Link to={`/drives/${drive.driveId}`} className="hover:underline">
                    {drive.companyName}
                  </Link>
                  <Badge tone={driveTypeTone(drive.driveType)}>
                    {driveTypeLabel(drive.driveType)}
                  </Badge>
                </p>
                <p className="text-sm text-ink-500">
                  {`${drive.roleTitle}${ctc !== null ? ` · ${ctc}` : ""}`}
                  {closeDate !== null &&
                    ` · applications ${closed ? "closed" : "close"} ${closeDate}`}
                </p>
              </>
            )}
            {nested && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
                <Link
                  to={`/drives/${drive.driveId}`}
                  className="text-xs font-semibold text-brand-700 underline underline-offset-2"
                >
                  Open the drive record
                </Link>
                {closeDate !== null && (
                  <span>
                    applications {closed ? "closed" : "close"} {closeDate}
                  </span>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {hats.map((hat) => (
                <Badge key={hat} tone="brand">
                  {ROLE_LABEL[hat]}
                </Badge>
              ))}
              {!nested && (
                <Badge tone={progress.terminal ? "neutral" : "warning"}>{progress.phase}</Badge>
              )}
              {window.urgent && <Badge tone="danger">Closing soon</Badge>}
              <Badge tone={window.state === "open" ? "success" : "neutral"}>{window.label}</Badge>
              {drive.totalRounds > 0 && (
                <span className="text-xs text-ink-500">
                  {progress.roundsDecided} of {progress.totalRounds} rounds decided
                </span>
              )}
            </div>
          </div>

          <div className="w-full sm:w-48">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-label={`${who} progress`}
              aria-valuenow={progress.percentComplete}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-brand-500"
                style={{ width: `${progress.percentComplete}%` }}
              />
            </div>
            <p className="mt-1 text-right text-xs text-ink-500">
              {progress.percentComplete}% through the pipeline
            </p>
          </div>
        </div>

        {progress.blocked !== null && (
          <p className="mt-3 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-700">
            {progress.blocked}
          </p>
        )}

        <section
          aria-label={`${who} applicants`}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Link to={`/drives/${drive.driveId}?stage=applied`} className="block">
            <StatCard label="Applied" value={funnel.applied} />
          </Link>
          <Link to={`/drives/${drive.driveId}?stage=shortlisted`} className="block">
            <StatCard label="Shortlisted" value={funnel.shortlisted} tone="brand" />
          </Link>
          <Link to={`/drives/${drive.driveId}?stage=in_rounds`} className="block">
            <StatCard label="In rounds" value={funnel.inRounds} tone="warning" />
          </Link>
          <Link to={`/drives/${drive.driveId}?stage=offers`} className="block">
            <StatCard label="Offers" value={funnel.offers} tone="success" />
          </Link>
          <Link to={`/drives/${drive.driveId}?stage=not_selected`} className="block">
            <StatCard label="Not selected" value={funnel.notSelected} />
          </Link>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {mayViewApplicants && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={
                nested
                  ? `View applicants for ${drive.roleTitle}`
                  : `View applicants to ${drive.companyName}`
              }
              onClick={() =>
                setOpenVisit({
                  company: event.companyName,
                  when: event.tentativeDate,
                  roles: event.roles,
                  activeId: drive.driveId,
                })
              }
            >
              View applicants
            </Button>
          )}

          {mayShortlist && funnel.applied > 0 && (
            <Link
              to={`/central/shortlisting?drive=${drive.driveId}`}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Shortlist applicants
            </Link>
          )}
        </div>
      </section>
    );

    return content;
  }
}
