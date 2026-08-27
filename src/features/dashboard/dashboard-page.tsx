import { Badge, Card, PageHeader, StatCard } from "@components/ui";
import { type PlacementCtc, summariseCtc, summariseCtcByCategory } from "@domain/ctc-statistics";
import { applicationWindow, driveOutcome } from "@domain/drive-analytics";
import { type DriveParticipation, driveFunnel } from "@domain/drive-funnel";
import { sameMoney } from "@domain/math";
import { type OfferCategory, offerCategoryLabelOf } from "@domain/offer-category";
import { registrationFunnel } from "@domain/registration-funnel";
import { computePlacementStats, type StudentPlacementFacts } from "@domain/statistics";
import type { DirectoryFilter } from "@domain/student-directory";
import type { SrfStatus } from "@domain/types";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

export interface CampusBreakdown {
  readonly campusId: string;
  readonly campusName: string;
  readonly eligible: number;
  readonly placed: number;
}

/**
 * One row per student, carrying everything the domain rules need: the
 * placement facts for `computePlacementStats` and the registration facts for
 * `registrationFunnel`. One row rather than two lists, so the funnel can never
 * be computed over a different population than the placement rate.
 */
export type DashboardStudent = StudentPlacementFacts & {
  readonly srfStatus: SrfStatus;
  readonly hasApplied: boolean;
  /** F4: the campus switcher filters on this, so it must be per student. */
  readonly campusId: string;
  readonly campusName: string;
};

/**
 * One drive's progress, as the domain's `driveFunnel` needs it. F5.
 *
 * `campusNames` is the drive's TARGETING, which is what the college filter
 * matches on: the question is "how is this drive going at that college", and a
 * drive never opened there has no answer.
 */
export interface DriveProgressSnapshot {
  readonly driveId: string;
  readonly driveName: string;
  readonly campusNames: readonly string[];
  readonly participation: DriveParticipation;
}

export interface LiveDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  /** Students this drive is actually open to, judged by R5. */
  readonly eligible: number;
  readonly applied: number;
  readonly offers: number;
}

export interface DashboardSnapshot {
  readonly students: readonly DashboardStudent[];
  readonly liveDrives: readonly LiveDrive[];
  /**
   * The instant the snapshot was taken, ISO. Passed in rather than read from
   * the browser: a laptop clock is not the authority on when a drive closes,
   * and a component that calls Date.now() cannot be tested.
   */
  readonly now: string;
  /**
   * One entry per PLACED student, already reduced to their placement record
   * (R9) by the view. Never one per offer - see src/domain/ctc-statistics.ts.
   */
  readonly placements: readonly PlacementCtc[];
  readonly drivesByStatus: Readonly<Record<string, number>>;
  readonly offersByCategory: Readonly<Record<string, number>>;
  readonly campuses: readonly CampusBreakdown[];
  /** F5: the drive-specific box. Empty until a drive has an audience. */
  readonly driveProgress: readonly DriveProgressSnapshot[];
}

export interface DashboardView {
  snapshot(): Promise<DashboardSnapshot>;
}

const label = (value: string) => value.replaceAll("_", " ");

/** Money, as read aloud: "₹8 LPA", never "₹8.00 LPA". */
const lpa = (value: number | null) => (value === null ? "—" : `₹${value} LPA`);

const rate = (placed: number, eligible: number) =>
  eligible === 0 ? 0 : Math.round((placed / eligible) * 1000) / 10;

/** Which funnel row opens which population. The row's own count, exactly. */
const FUNNEL_FILTER: Readonly<Record<string, DirectoryFilter | undefined>> = {
  on_roster: undefined,
  submitted: "submitted",
  verified: "verified",
  // NOT `placed`: that filter includes self-placed students (C1) and this row
  // counts on-campus placements only (PRD 16.2). The link used to open a
  // longer list than the number that opened it.
  placed: "on_campus",
};

/**
 * The read-only executive view (A20).
 *
 * Every headline number comes from src/domain/statistics.ts, so the rate shown
 * to a CEO is the same rule the coordinators work against. A dashboard that
 * computes its own version of "placed" is how two departments end up quoting
 * different numbers from the same database.
 */
export function DashboardPage({ view, title }: { view: DashboardView; title: string }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  /** "" is every campus — the default the request asked for (F4). */
  const [campusId, setCampusId] = useState("");
  const [driveQuery, setDriveQuery] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("");

  useEffect(() => {
    void view.snapshot().then(setSnapshot);
  }, [view]);

  /**
   * F4: "available both overall and campus-wise ... the ability to switch
   * between individual campuses to analyze the registration and placement
   * funnel for each campus separately."
   *
   * Filtered ONCE, here, and fed to both the funnel and the placement stats:
   * two filters would eventually disagree and the screen would quote two
   * different cohorts side by side.
   */
  const cohort = useMemo(
    () =>
      snapshot === null
        ? []
        : campusId === ""
          ? snapshot.students
          : snapshot.students.filter((s) => s.campusId === campusId),
    [snapshot, campusId],
  );

  const stats = useMemo(() => computePlacementStats({ students: cohort }), [cohort]);

  const funnel = useMemo(() => registrationFunnel(cohort), [cohort]);

  const campusName =
    snapshot?.campuses.find((c) => c.campusId === campusId)?.campusName ?? "All campuses";

  /** Every college any drive was opened to, for the drive box's filter. */
  const colleges = useMemo(
    () =>
      [...new Set((snapshot?.driveProgress ?? []).flatMap((d) => d.campusNames))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [snapshot],
  );

  const drives = useMemo(() => {
    const query = driveQuery.trim().toLowerCase();
    return (snapshot?.driveProgress ?? [])
      .filter((d) => query === "" || d.driveName.toLowerCase().includes(query))
      .filter((d) => collegeFilter === "" || d.campusNames.includes(collegeFilter))
      .map((d) => ({ ...d, funnel: driveFunnel(d.participation) }));
  }, [snapshot, driveQuery, collegeFilter]);

  const packages = useMemo(
    () => (snapshot === null ? null : summariseCtc(snapshot.placements)),
    [snapshot],
  );

  const packagesByCategory = useMemo(
    () => (snapshot === null ? [] : summariseCtcByCategory(snapshot.placements)),
    [snapshot],
  );

  /**
   * Every number on this page opens the students behind it (2026-08-26,
   * copying the Live-drives cards). Built in one place so the campus in view
   * is carried EVERY time: a card pressed while one campus is selected must
   * not open the whole organisation, which would contradict the figure that
   * was pressed.
   */
  function studentsLink(
    to: {
      filter?: DirectoryFilter | undefined;
      category?: OfferCategory | undefined;
      ctc?: number | undefined;
      /** Overrides the switcher — the campus breakdown links to its own row. */
      campus?: string | undefined;
    } = {},
  ): string {
    const search = new URLSearchParams();
    if (to.filter !== undefined) search.set("filter", to.filter);

    const campus = to.campus ?? (campusId === "" ? undefined : campusName);
    if (campus !== undefined) search.set("campus", campus);

    if (to.category !== undefined) search.set("category", to.category);
    if (to.ctc !== undefined) search.set("ctc", String(to.ctc));

    const query = search.toString();
    return query === "" ? "/central/students" : `/central/students?${query}`;
  }

  /**
   * A package figure opens its holders — but only when somebody holds it.
   *
   * The median of an even-sized cohort is the midpoint of two packages and the
   * average is nobody's salary, so linking those to `ctc=` would land the
   * reader on an empty list and teach them that these numbers are not worth
   * pressing. They open the placed list instead.
   */
  function packageLink(figure: number | null): string {
    if (figure === null) return studentsLink({ filter: "placed" });
    const held = (snapshot?.placements ?? []).some((p) => sameMoney(p.ctcLpa, figure));
    return held
      ? studentsLink({ filter: "placed", ctc: figure })
      : studentsLink({ filter: "placed" });
  }

  if (snapshot === null) {
    return (
      <div>
        <PageHeader title={title} />
        <p role="status" className="text-sm text-ink-500">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle="Opt-outs leave the denominator; self-placed is its own line."
      />

      {/* F4: all campuses by default, one campus on request. */}
      {snapshot.campuses.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label htmlFor="campus-filter" className="text-sm font-medium text-ink-700">
            Campus
          </label>
          <select
            id="campus-filter"
            value={campusId}
            onChange={(e) => setCampusId(e.target.value)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="">All campuses</option>
            {snapshot.campuses.map((campus) => (
              <option key={campus.campusId} value={campus.campusId}>
                {campus.campusName}
              </option>
            ))}
          </select>
          {/* A filtered screen that does not say so is read as the whole org. */}
          {campusId !== "" && <Badge tone="brand">Showing {campusName}</Badge>}
        </div>
      )}

      {snapshot.students.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No students yet. Import a campus roster to begin.</p>
        </Card>
      ) : (
        <>
          {/* 2026-08-26: every card opens the students it counted, exactly as
              the Live-drives cards open their applicants. */}
          <section aria-label="Headline" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Link to={studentsLink({ filter: "on_campus" })} className="block">
              <StatCard label="Placement rate" value={`${stats.placementRate}%`} tone="brand" />
            </Link>
            <Link to={studentsLink({ filter: "on_campus" })} className="block">
              <StatCard
                label="Placed on campus"
                value={stats.placed}
                hint={`of ${stats.eligible} eligible`}
              />
            </Link>
            <Link to={studentsLink({ filter: "self_placed" })} className="block">
              <StatCard label="Self-placed" value={stats.selfPlaced} tone="warning" />
            </Link>
            {/* Opt-outs leave the placement denominator, so the number they
                leave by is reported rather than quietly absorbed. */}
            <Link to={studentsLink({ filter: "opted_out" })} className="block">
              <StatCard label="Opted out" value={stats.optedOut} />
            </Link>
            {/* The one card that is not about students, so it opens the drives
                instead - and the campus switcher does not apply to it. */}
            <Link to="/central/drives/completed" className="block">
              <StatCard
                label="Drives completed"
                value={snapshot.drivesByStatus.completed ?? 0}
                hint={`${snapshot.liveDrives.length} open now`}
              />
            </Link>
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              {/* F5: renamed, because "funnel" promised a drive-by-drive story
                  it could not tell. These four are facts about a STUDENT. */}
              <section aria-label="Students overview">
                <h2 className="text-lg text-ink-900">Students overview</h2>
                <p className="mt-1 mb-3 text-sm text-ink-500">
                  Where the cohort is, from the roster to a signed offer.
                </p>
                <ol className="space-y-2">
                  {funnel.map((stage) => {
                    /*
                     * 2026-08-17: the Placed count opens the students behind
                     * it. 2026-08-26: so does every other stage - the student
                     * directory can now filter to each of these populations,
                     * so "no breakdown to open" stopped being true.
                     */
                    const row = (
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink-700">{stage.label}</span>
                        <span className="shrink-0">
                          <span className="font-semibold text-ink-900">{stage.count}</span>{" "}
                          <span className="text-xs text-ink-500">{stage.percentOfRoster}%</span>
                        </span>
                      </div>
                    );

                    return (
                      <li key={stage.key}>
                        <Link
                          to={studentsLink({ filter: FUNNEL_FILTER[stage.key] })}
                          className="block rounded-lg transition-colors hover:bg-brand-50"
                        >
                          {row}
                        </Link>
                        {/* The bar is the point: a stage that drops off a cliff
                          is visible before the numbers are read. */}
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${stage.percentOfRoster}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </Card>

            <Card className="p-5">
              <section aria-label="Package">
                <h2 className="text-lg text-ink-900">Package</h2>
                {packages === null || packages.count === 0 ? (
                  <p className="mt-3 text-sm text-ink-700">
                    No packages yet. Figures appear as soon as the first offer is declared.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 mb-3 text-sm text-ink-500">
                      One figure per placed student. A student holding several offers is counted
                      once, at their best one.
                    </p>
                    <section aria-label="Package figures">
                      <dl className="grid grid-cols-2 gap-3">
                        {[
                          ["Highest", packages.highestLpa],
                          ["Average", packages.averageLpa],
                          ["Median", packages.medianLpa],
                          ["Lowest", packages.lowestLpa],
                        ].map(([name, value]) => (
                          <Link
                            key={name as string}
                            to={packageLink(value as number | null)}
                            className="block rounded-lg bg-surface-muted p-3 transition-colors hover:bg-brand-50"
                          >
                            <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                              {name}
                            </dt>
                            <dd className="mt-0.5 font-heading text-lg font-bold text-ink-900">
                              {lpa(value as number | null)}
                            </dd>
                          </Link>
                        ))}
                      </dl>
                    </section>

                    {packagesByCategory.length > 0 && (
                      <ul
                        aria-label="Package by category"
                        className="mt-4 divide-y divide-line border-t border-line"
                      >
                        {packagesByCategory.map(({ category, stats: byCategory }) => (
                          <li key={category}>
                            <Link
                              to={studentsLink({ filter: "placed", category })}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg py-2 text-sm transition-colors hover:bg-brand-50"
                            >
                              {/* 2026-08-27: the domain's spelling. The
                                  `capitalize` class was a stylesheet spelling
                                  a domain value — and it could not have
                                  rescued "internship" once (10) made it a
                                  category. */}
                              <span className="text-ink-700">{offerCategoryLabelOf(category)}</span>
                              <span className="text-ink-500">
                                {byCategory.count} placed · avg{" "}
                                <span className="font-semibold text-ink-900">
                                  {lpa(byCategory.averageLpa)}
                                </span>{" "}
                                · high {lpa(byCategory.highestLpa)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-lg text-ink-900">Drives by status</h2>
              <ul className="mt-3 space-y-2">
                {Object.entries(snapshot.drivesByStatus).map(([status, count]) => (
                  <li key={status} className="flex justify-between text-sm">
                    <span className="capitalize text-ink-700">{label(status)}</span>
                    <span className="font-semibold text-ink-900">{count}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <section aria-label="Offers by category">
                <h2 className="text-lg text-ink-900">Offers by category</h2>
                {/* These count OFFER ROWS; the directory behind them counts
                    STUDENTS by their one displayed placement. A student
                    holding two Dream offers is 2 here and 1 there. */}
                <ul className="mt-3 space-y-2">
                  {Object.entries(snapshot.offersByCategory).map(([category, count]) => (
                    <li key={category}>
                      <Link
                        to={studentsLink({
                          filter: "placed",
                          category: category as OfferCategory,
                        })}
                        className="flex justify-between rounded-lg text-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="text-ink-700">{offerCategoryLabelOf(category)}</span>
                        <span className="font-semibold text-ink-900">{count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Card>
          </div>

          <Card className="mt-6 p-5">
            <section aria-label="Open drives">
              <h2 className="text-lg text-ink-900">Open drives</h2>
              {snapshot.liveDrives.length === 0 ? (
                <p className="mt-3 text-sm text-ink-700">
                  No drives are open right now. Published drives appear here with the time left to
                  apply.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {snapshot.liveDrives.map((drive) => {
                    const window = applicationWindow(
                      {
                        start:
                          drive.applicationStart === null ? null : new Date(drive.applicationStart),
                        end: drive.applicationEnd === null ? null : new Date(drive.applicationEnd),
                      },
                      new Date(snapshot.now),
                    );
                    const outcome = driveOutcome(drive);

                    return (
                      <li key={drive.driveId} className="py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink-900">{drive.companyName}</p>
                            {drive.roleTitle !== null && (
                              <p className="text-sm text-ink-500">{drive.roleTitle}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {window.urgent && <Badge tone="danger">Closing soon</Badge>}
                            <Badge tone={window.state === "open" ? "brand" : "neutral"}>
                              {window.label}
                            </Badge>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                          <span>
                            <span className="font-semibold text-ink-900">
                              {drive.applied} of {drive.eligible} eligible
                            </span>{" "}
                            applied
                          </span>
                          <span className="font-semibold text-ink-900">
                            {outcome.applicationRate}%
                          </span>
                          <span>{drive.offers} offers</span>
                        </div>

                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${outcome.applicationRate}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </Card>

          {/*
           * F5: the drive-specific box. It was the fourth row of the funnel,
           * where its denominator was the roster rather than the drive's own
           * audience — so the one number anybody wanted to act on was the one
           * number that was wrong.
           */}
          <Card className="mt-6 p-5">
            <section aria-label="Drive progress">
              <h2 className="text-lg text-ink-900">Drive progress</h2>
              <p className="mt-1 mb-4 text-sm text-ink-500">
                Eligible students, applications, and attendance and clearance in each round through
                to the final offer.
              </p>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="drive-name-filter"
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    Drive name
                  </label>
                  <input
                    id="drive-name-filter"
                    value={driveQuery}
                    onChange={(e) => setDriveQuery(e.target.value)}
                    placeholder="All drives"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="drive-college-filter"
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    College name
                  </label>
                  <select
                    id="drive-college-filter"
                    value={collegeFilter}
                    onChange={(e) => setCollegeFilter(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  >
                    <option value="">All colleges</option>
                    {colleges.map((college) => (
                      <option key={college} value={college}>
                        {college}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {drives.length === 0 ? (
                <p className="text-sm text-ink-700">
                  No drives match these filters yet. Published drives appear here as students become
                  eligible for them.
                </p>
              ) : (
                <div className="space-y-5">
                  {drives.map((drive) => (
                    <div key={drive.driveId} className="rounded-lg border border-line p-4">
                      <p className="font-semibold text-ink-900">{drive.driveName}</p>
                      <p className="text-xs text-ink-500">
                        {drive.campusNames.length === 0
                          ? "Open to every campus"
                          : drive.campusNames.join(" · ")}
                      </p>

                      <ol className="mt-3 space-y-2">
                        {drive.funnel.stages.map((stage) => {
                          const round = drive.funnel.rounds.find((r) => r.roundId === stage.key);
                          return (
                            <li key={stage.key}>
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="text-ink-700">{stage.label}</span>
                                <span className="font-semibold text-ink-900">{stage.count}</span>
                              </div>
                              {round !== undefined && (
                                <p className="mt-0.5 text-xs text-ink-500">
                                  <span>
                                    {round.present} of {round.scheduled} attended
                                  </span>{" "}
                                  · <span>{round.cleared} cleared</span> ·{" "}
                                  <span>{round.clearanceRate}% clearance</span>
                                  {round.unconfirmed > 0 && (
                                    <span> · {round.unconfirmed} unconfirmed</span>
                                  )}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </Card>

          <Card className="mt-6 p-5">
            <section aria-label="By campus">
              <h2 className="text-lg text-ink-900">By campus</h2>
              <ul className="mt-3 divide-y divide-neutral-200">
                {snapshot.campuses.map((campus) => (
                  <li key={campus.campusId}>
                    {/* Its own campus, not the switcher's: this row is the
                        answer for THAT college. */}
                    <Link
                      to={studentsLink({ campus: campus.campusName })}
                      className="flex items-center justify-between gap-4 rounded-lg py-2 text-sm transition-colors hover:bg-brand-50"
                    >
                      <span className="text-ink-800">{campus.campusName}</span>
                      <span className="text-ink-500">
                        {campus.placed} of {campus.eligible} ·{" "}
                        <span className="font-semibold text-ink-900">
                          {rate(campus.placed, campus.eligible)}%
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        </>
      )}
    </div>
  );
}
