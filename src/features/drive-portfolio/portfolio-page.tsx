import { DriveAnalyticsReadouts, DriveDateFilter } from "@components/drive-date-filter";
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
  ButtonLink,
  Card,
  PageHeader,
  StatCard,
} from "@components/ui";
import { visitAccent } from "@components/visit-accent";
import { VisitPane, type VisitPaneRole } from "@components/visit-pane";
import { groupDrivesByEvent, paginateVisitsByRowBudget } from "@domain/company-drive";
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
import { driveStatusTone } from "@domain/drive-status";
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

/**
 * The real `company_drives` row behind a visit, for links that attach another
 * role to it.
 *
 * Since a visit is now identified by company + day, its group key is not an
 * event id — separately raised drives of one visit carry different event ids.
 * The first role that still has one is the row an added role can attach to.
 */
function visitEventId(event: PortfolioEvent): string {
  return (
    event.roles.find(
      (role) => typeof role.companyDriveId === "string" && role.companyDriveId !== "",
    )?.companyDriveId ?? ""
  );
}

/** Groups portfolio drives by company visit. */
function groupPortfolioByEvent(drives: readonly PortfolioDrive[]): PortfolioEvent[] {
  const groups = groupDrivesByEvent(drives);

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

/**
 * How many role rows one page of visit cards may hold.
 *
 * 2026-11-02: the list mounted every visit at once, so an AE who raised twenty
 * companies scrolled past forty cards to reach the one they were called about.
 * A page fills with WHOLE visits up to this budget — the same rule and the same
 * choices the CPC's Drive progress table uses, so one screen is never taller
 * than the other for the same work.
 */
const ROW_BUDGETS = [10, 15, 25, 50] as const;
const DEFAULT_ROW_BUDGET = 15;

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
  subtitle,
  role,
  statuses,
  /** Passed in, never read from the browser — see src/domain/drive-analytics. */
  now = new Date(),
}: {
  view: PortfolioView;
  profileId: string;
  title: string;
  subtitle?: string;
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
  /** Which page of visit cards is on screen, and how tall a page may be. */
  const [page, setPage] = useState(1);
  const [rowBudget, setRowBudget] = useState<number>(DEFAULT_ROW_BUDGET);

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

  /**
   * What each chip is worth, counted before the search narrows anything.
   *
   * The chips count company visits, the same rule the Central cockpit's
   * identical chips follow (2026-10-17): a visit that raised three roles is one
   * card on this list, so it is one count. A visit that genuinely mixes types
   * is honestly in both of those buckets.
   */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { "": groupDrivesByEvent(dateFiltered).size };
    for (const option of DRIVE_TYPE_FILTERS) {
      if (option.value !== "") {
        counts[option.value] = groupDrivesByEvent(
          dateFiltered.filter((d) => d.driveType === option.value),
        ).size;
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

  const pages = useMemo(
    () => paginateVisitsByRowBudget(activeEvents, (event) => event.roles.length, rowBudget),
    [activeEvents, rowBudget],
  );
  const visitPageCount = Math.max(1, pages.length);
  const current = Math.min(page, visitPageCount);
  const pageEvents = pages[current - 1] ?? [];
  const rowsOnPage = pageEvents.reduce((rows, event) => rows + event.roles.length, 0);
  const visitsBefore = pages
    .slice(0, current - 1)
    .reduce((visits, earlier) => visits + earlier.length, 0);
  /** Every visit the list holds, whether it is on this page or folded under Expired. */
  const visitTotal = activeEvents.length + expiredEvents.length;

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
        subtitle={subtitle ?? "Every drive I raise or approve — and what has become of it."}
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
          {/* One card for every filter (2026-11-02). Search, type, date and
              sort used to be four stacked blocks of chrome over one list.
              Unified into a sleek, clean, modern control center. */}
          {/* Unified Filters & Analytics Command Center (2026-11-02).
              Combined all filtering controls and live analytics into a single cohesive,
              modern dashboard card instead of stacked disjointed chrome panels. */}
          <Card className="mb-5 overflow-hidden rounded-2xl border border-line/80 bg-surface p-0 shadow-xs">
            {/* Filter toolbar */}
            <div className="p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <DriveSearch
                    value={query}
                    onChange={(q) => {
                      setQuery(q);
                      setPage(1);
                    }}
                    compact
                  />
                  <DriveTypeFilter
                    value={type}
                    onChange={(t) => {
                      setType(t);
                      setPage(1);
                    }}
                    counts={typeCounts}
                    className=""
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <DriveDateFilter
                    criteria={dateCriteria}
                    onChange={(c) => {
                      setDateCriteria(c);
                      setPage(1);
                    }}
                    drives={visible}
                    compact
                  />
                  <DriveSort
                    value={order}
                    onChange={(o) => {
                      setOrder(o);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Integrated Live Analytics Metrics */}
            <div className="border-t border-line/60 bg-surface-muted/20 px-4 py-3 sm:px-6">
              <DriveAnalyticsReadouts
                drives={visible}
                embedded
                className="border-0 bg-transparent p-0 shadow-none"
              />
            </div>

            {/* Scope / visit count footer */}
            <div className="border-t border-line/40 bg-surface px-4 py-2 sm:px-5">
              <p className="text-xs text-ink-500">
                {visitTotal} {visitTotal === 1 ? "visit" : "visits"} · {visible.length}{" "}
                {visible.length === 1 ? "role" : "roles"} in view
                {visible.length === inScope.length ? "" : ` of ${inScope.length} in all`}
              </p>
            </div>
          </Card>

          {visible.length === 0 ? (
            <Card className="p-6">
              <NoDriveMatches
                query={query}
                {...(type === "" ? {} : { typeLabel: driveTypeLabel(type) })}
              />
            </Card>
          ) : (
            <>
              {pageEvents.length > 0 && (
                <ul className="flex flex-col gap-4">
                  {pageEvents.map((event, index) => renderEvent(event, visitsBefore + index))}
                </ul>
              )}

              {expiredEvents.length > 0 && (
                <Accordion
                  className="mt-4 rounded-2xl border border-line/80 bg-surface shadow-xs"
                  defaultValue={activeEvents.length === 0 ? ["expired"] : []}
                >
                  <AccordionItem value="expired">
                    <AccordionTrigger className="px-5 py-3.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
                      Expired — application deadline passed ({expiredEvents.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="flex flex-col gap-4 p-4 sm:p-5 pt-0">
                        {expiredEvents.map((event, index) =>
                          renderEvent(event, activeEvents.length + index),
                        )}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              {/* The strip stays on screen at the bottom of the list */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/80 bg-surface px-4 py-3 text-xs text-ink-600 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    {pageEvents.length === 0
                      ? `Showing 0 active visits of ${visitTotal} · ${expiredEvents.length} past-deadline ${expiredEvents.length === 1 ? "visit" : "visits"} below`
                      : `Showing visits ${visitsBefore + 1} to ${visitsBefore + pageEvents.length} of ${visitTotal} · ${rowsOnPage} ${rowsOnPage === 1 ? "role row" : "role rows"} on this page`}
                  </span>
                  <div className="ml-2 flex items-center gap-1.5">
                    <span className="text-ink-500 font-medium">Rows:</span>
                    <select
                      aria-label="Rows per page"
                      value={rowBudget}
                      onChange={(e) => {
                        setRowBudget(Number(e.target.value));
                        setPage(1);
                      }}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-800 outline-none focus:border-brand-500"
                    >
                      {ROW_BUDGETS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={current <= 1}
                    onClick={() => setPage(current - 1)}
                    className="rounded-lg text-xs"
                  >
                    Previous
                  </Button>
                  <span className="px-1.5 font-semibold text-ink-700">
                    Page {current} of {visitPageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={current >= visitPageCount}
                    onClick={() => setPage(current + 1)}
                    className="rounded-lg text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
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
            <ButtonLink
              size="sm"
              variant="secondary"
              to={`/drives/${role.driveId}`}
              aria-label={`View ${role.roleTitle}`}
            >
              View
            </ButtonLink>
          </p>
          {applicantList(role)}
        </>
      ),
    }));
  }

  function renderEvent(event: PortfolioEvent, accentIndex: number) {
    const isMultiRole = event.roles.length > 1;
    const types = visitType(event.roles);
    const accent = visitAccent(accentIndex);

    return (
      <li key={event.eventId}>
        <Card className="overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-xs transition-all hover:border-line hover:shadow-sm">
          {/* Event Header for multi-role drives */}
          {isMultiRole && (
            <div className={`border-b border-line/70 ${accent.band} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-lg font-bold text-ink-900">
                    {event.companyName}
                  </h3>
                  {!types.mixed && types.single !== null && (
                    <Badge tone={driveTypeTone(types.single)} variant="pill">
                      {driveTypeLabel(types.single)}
                    </Badge>
                  )}
                  {types.mixed && (
                    <Badge tone="neutral" variant="pill">
                      Mixed types
                    </Badge>
                  )}
                  <Badge tone="brand" variant="pill">
                    {event.roles.length} roles
                  </Badge>
                </div>
                {event.tentativeDate && (
                  <span className="text-xs font-medium text-ink-500">
                    {new Date(event.tentativeDate).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-700">
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
            <Accordion
              multiple
              defaultValue={event.roles.map((drive) => drive.driveId)}
              className="divide-y divide-line/60"
            >
              {event.roles.map((drive) => {
                const progress = driveProgress(drive);
                const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);
                return (
                  <AccordionItem key={drive.driveId} value={drive.driveId}>
                    <AccordionTrigger className="px-4 py-3 sm:px-5 hover:bg-surface-muted/30">
                      <span className="font-semibold text-ink-900">
                        {drive.roleTitle}
                        {ctc !== null && ` · ${ctc}`}
                      </span>
                      {types.mixed && (
                        <Badge tone={driveTypeTone(drive.driveType)} variant="pill">
                          {driveTypeLabel(drive.driveType)}
                        </Badge>
                      )}
                      {/* The colour comes from the lifecycle status, not from
                          "anything unfinished is a warning": a Live drive is
                          healthy green, an approved-but-unpublished one is
                          amber because someone owes the next step. */}
                      {(() => {
                        const isExpired =
                          drive.applicationEnd !== null &&
                          new Date(drive.applicationEnd).getTime() < now.getTime();
                        const phaseText =
                          isExpired && progress.phase === "Applications open"
                            ? "Applications closed"
                            : progress.phase;
                        const phaseTone =
                          phaseText === "Applications closed"
                            ? "neutral"
                            : driveStatusTone(drive.status);
                        return (
                          <Badge tone={phaseTone} variant="pill">
                            {phaseText}
                          </Badge>
                        );
                      })()}
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
            <div className="border-t border-line/60 bg-surface-muted/30 px-4 py-2.5 sm:px-5">
              {(() => {
                const refused = visitRoleFreeze(event);
                return refused !== null ? (
                  <p className="text-xs text-ink-500">{refused} No further roles can be raised.</p>
                ) : (
                  <ButtonLink
                    size="sm"
                    variant="ghost"
                    to={`/ae/pif?companyName=${encodeURIComponent(event.companyName)}&companyDriveId=${encodeURIComponent(
                      visitEventId(event),
                    )}&tentativeDate=${encodeURIComponent(event.tentativeDate ?? "")}`}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    + Add another role
                    {isMultiRole ? "" : visitDayInParentheses(event.tentativeDate)}
                  </ButtonLink>
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
      <section aria-label={who} className={nested ? "p-4 sm:p-5" : "p-5 sm:p-6"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {!nested && (
              <>
                {/* The name is the fact; the card's one `View` below is the way
                    in. Both being clickable to the same record is the duplicate
                    the coordinator complained about. */}
                <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900">
                  {drive.companyName}
                  <Badge tone={driveTypeTone(drive.driveType)} variant="pill">
                    {driveTypeLabel(drive.driveType)}
                  </Badge>
                </p>
                <p className="text-sm text-ink-600 mt-0.5">
                  <span className="font-semibold text-ink-800">{drive.roleTitle}</span>
                  {ctc !== null && ` · ${ctc}`}
                  {closeDate !== null &&
                    ` · applications ${closed ? "closed" : "close"} ${closeDate}`}
                </p>
              </>
            )}
            {nested && closeDate !== null && (
              <p className="text-xs text-ink-500">
                applications {closed ? "closed" : "close"} {closeDate}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {hats.map((hat) => (
                <Badge key={hat} tone="brand" variant="pill">
                  {ROLE_LABEL[hat]}
                </Badge>
              ))}
              {!nested &&
                !(
                  window.state === "closed" &&
                  (progress.phase === "Applications open" ||
                    progress.phase === "Applications closed")
                ) && (
                  <Badge tone={driveStatusTone(drive.status)} variant="pill">
                    {progress.phase}
                  </Badge>
                )}
              {window.urgent && (
                <Badge tone="danger" variant="pill">
                  Closing soon
                </Badge>
              )}
              <Badge tone={window.state === "open" ? "success" : "neutral"} variant="pill">
                {window.label}
              </Badge>
              {drive.totalRounds > 0 && (
                <span className="text-xs text-ink-500">
                  {progress.roundsDecided} of {progress.totalRounds} rounds decided
                </span>
              )}
            </div>
          </div>

          <div className="w-full sm:w-44 shrink-0">
            <div className="flex items-center justify-between text-xs mb-1 text-ink-500">
              <span className="font-medium">Pipeline</span>
              <span className="font-semibold text-ink-800">{progress.percentComplete}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted border border-line/40"
              role="progressbar"
              aria-label={`${who} progress`}
              aria-valuenow={progress.percentComplete}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${progress.percentComplete}%` }}
              />
            </div>
          </div>
        </div>

        {progress.blocked !== null && (
          <p className="mt-3 rounded-xl border border-gold-200/80 bg-gold-50/60 px-3.5 py-2 text-xs text-gold-800">
            {progress.blocked}
          </p>
        )}

        <section
          aria-label={`${who} applicants`}
          className="mt-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5"
        >
          <StatCard
            size="sm"
            actionLabel=""
            label="Applied"
            value={funnel.applied}
            to={`/drives/${drive.driveId}?stage=applied`}
            className="!bg-surface !border-line/70 hover:!border-brand-400 hover:!bg-surface-muted/20"
          />
          <StatCard
            size="sm"
            actionLabel=""
            label="Shortlisted"
            value={funnel.shortlisted}
            tone="brand"
            to={`/drives/${drive.driveId}?stage=shortlisted`}
            className="!bg-surface !border-line/70 hover:!border-brand-400 hover:!bg-surface-muted/20"
          />
          <StatCard
            size="sm"
            actionLabel=""
            label="In rounds"
            value={funnel.inRounds}
            tone="warning"
            to={`/drives/${drive.driveId}?stage=in_rounds`}
            className="!bg-surface !border-line/70 hover:!border-brand-400 hover:!bg-surface-muted/20"
          />
          <StatCard
            size="sm"
            actionLabel=""
            label="Offers"
            value={funnel.offers}
            tone="success"
            to={`/drives/${drive.driveId}?stage=offers`}
            className="!bg-surface !border-line/70 hover:!border-brand-400 hover:!bg-surface-muted/20"
          />
          <StatCard
            size="sm"
            actionLabel=""
            label="Not selected"
            value={funnel.notSelected}
            to={`/drives/${drive.driveId}?stage=not_selected`}
            className="!bg-surface !border-line/70 hover:!border-brand-400 hover:!bg-surface-muted/20"
          />
        </section>

        <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-3 border-t border-line/50">
          {/* The card's ONE `View`: it opens the role's record, and the role it
              belongs to is in the accessible name because a visit's panels sit
              side by side on the same card. */}
          <ButtonLink
            size="sm"
            to={`/drives/${drive.driveId}`}
            aria-label={`View ${drive.companyName} — ${drive.roleTitle}`}
            className="rounded-lg font-medium"
          >
            View
          </ButtonLink>

          {mayViewApplicants && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={
                nested
                  ? `See the applicants for ${drive.roleTitle}`
                  : `See the applicants to ${drive.companyName}`
              }
              onClick={() =>
                setOpenVisit({
                  company: event.companyName,
                  when: event.tentativeDate,
                  roles: event.roles,
                  activeId: drive.driveId,
                })
              }
              className="rounded-lg font-medium"
            >
              See applicants
            </Button>
          )}

          {mayShortlist && funnel.applied > 0 && (
            <ButtonLink
              size="sm"
              variant="secondary"
              to={`/central/shortlisting?drive=${drive.driveId}`}
              className="rounded-lg font-medium"
            >
              Shortlist
            </ButtonLink>
          )}
        </div>
      </section>
    );

    return content;
  }
}
