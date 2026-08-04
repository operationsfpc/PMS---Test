import { Card, PageHeader, StatCard } from "@components/ui";
import { type PlacementCtc, summariseCtc, summariseCtcByCategory } from "@domain/ctc-statistics";
import { registrationFunnel } from "@domain/registration-funnel";
import { computePlacementStats, type StudentPlacementFacts } from "@domain/statistics";
import type { SrfStatus } from "@domain/types";
import { useEffect, useMemo, useState } from "react";

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
};

export interface DashboardSnapshot {
  readonly students: readonly DashboardStudent[];
  /**
   * One entry per PLACED student, already reduced to their placement record
   * (R9) by the view. Never one per offer - see src/domain/ctc-statistics.ts.
   */
  readonly placements: readonly PlacementCtc[];
  readonly drivesByStatus: Readonly<Record<string, number>>;
  readonly offersByCategory: Readonly<Record<string, number>>;
  readonly campuses: readonly CampusBreakdown[];
}

export interface DashboardView {
  snapshot(): Promise<DashboardSnapshot>;
}

const label = (value: string) => value.replaceAll("_", " ");

/** Money, as read aloud: "₹8 LPA", never "₹8.00 LPA". */
const lpa = (value: number | null) => (value === null ? "—" : `₹${value} LPA`);

const rate = (placed: number, eligible: number) =>
  eligible === 0 ? 0 : Math.round((placed / eligible) * 1000) / 10;

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

  useEffect(() => {
    void view.snapshot().then(setSnapshot);
  }, [view]);

  const stats = useMemo(
    () => (snapshot === null ? null : computePlacementStats({ students: snapshot.students })),
    [snapshot],
  );

  const funnel = useMemo(
    () => (snapshot === null ? [] : registrationFunnel(snapshot.students)),
    [snapshot],
  );

  const packages = useMemo(
    () => (snapshot === null ? null : summariseCtc(snapshot.placements)),
    [snapshot],
  );

  const packagesByCategory = useMemo(
    () => (snapshot === null ? [] : summariseCtcByCategory(snapshot.placements)),
    [snapshot],
  );

  if (snapshot === null || stats === null) {
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

      {snapshot.students.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No students yet. Import a campus roster to begin.</p>
        </Card>
      ) : (
        <>
          <section aria-label="Headline" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Placement rate" value={`${stats.placementRate}%`} tone="brand" />
            <StatCard
              label="Placed on campus"
              value={stats.placed}
              hint={`of ${stats.eligible} eligible`}
            />
            <StatCard label="Self-placed" value={stats.selfPlaced} tone="warning" />
            <StatCard label="Opted out" value={stats.optedOut} />
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <section aria-label="Registration funnel">
                <h2 className="text-lg text-ink-900">Registration funnel</h2>
                <p className="mt-1 mb-3 text-sm text-ink-500">
                  Where the cohort is, from the roster to a signed offer.
                </p>
                <ol className="space-y-2">
                  {funnel.map((stage) => (
                    <li key={stage.key}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink-700">{stage.label}</span>
                        <span className="shrink-0">
                          <span className="font-semibold text-ink-900">{stage.count}</span>{" "}
                          <span className="text-xs text-ink-500">{stage.percentOfRoster}%</span>
                        </span>
                      </div>
                      {/* The bar is the point: a stage that drops off a cliff
                          is visible before the numbers are read. */}
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${stage.percentOfRoster}%` }}
                        />
                      </div>
                    </li>
                  ))}
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
                      One figure per placed student, at their placement record (R9).
                    </p>
                    <section aria-label="Package figures">
                      <dl className="grid grid-cols-2 gap-3">
                        {[
                          ["Highest", packages.highestLpa],
                          ["Average", packages.averageLpa],
                          ["Median", packages.medianLpa],
                          ["Lowest", packages.lowestLpa],
                        ].map(([name, value]) => (
                          <div key={name as string} className="rounded-lg bg-surface-muted p-3">
                            <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                              {name}
                            </dt>
                            <dd className="mt-0.5 font-heading text-lg font-bold text-ink-900">
                              {lpa(value as number | null)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    {packagesByCategory.length > 0 && (
                      <ul
                        aria-label="Package by category"
                        className="mt-4 divide-y divide-line border-t border-line"
                      >
                        {packagesByCategory.map(({ category, stats: byCategory }) => (
                          <li
                            key={category}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                          >
                            <span className="capitalize text-ink-700">{label(category)}</span>
                            <span className="text-ink-500">
                              {byCategory.count} placed · avg{" "}
                              <span className="font-semibold text-ink-900">
                                {lpa(byCategory.averageLpa)}
                              </span>{" "}
                              · high {lpa(byCategory.highestLpa)}
                            </span>
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
                <ul className="mt-3 space-y-2">
                  {Object.entries(snapshot.offersByCategory).map(([category, count]) => (
                    <li key={category} className="flex justify-between text-sm">
                      <span className="capitalize text-ink-700">{label(category)}</span>
                      <span className="font-semibold text-ink-900">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </Card>
          </div>

          <Card className="mt-6 p-5">
            <section aria-label="By campus">
              <h2 className="text-lg text-ink-900">By campus</h2>
              <ul className="mt-3 divide-y divide-neutral-200">
                {snapshot.campuses.map((campus) => (
                  <li
                    key={campus.campusId}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="text-ink-800">{campus.campusName}</span>
                    <span className="text-ink-500">
                      {campus.placed} of {campus.eligible} ·{" "}
                      <span className="font-semibold text-ink-900">
                        {rate(campus.placed, campus.eligible)}%
                      </span>
                    </span>
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
