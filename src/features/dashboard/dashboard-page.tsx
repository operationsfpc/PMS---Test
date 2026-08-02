import { Card, PageHeader, StatCard } from "@components/ui";
import { computePlacementStats, type StudentPlacementFacts } from "@domain/statistics";
import { useEffect, useMemo, useState } from "react";

export interface CampusBreakdown {
  readonly campusId: string;
  readonly campusName: string;
  readonly eligible: number;
  readonly placed: number;
}

export interface DashboardSnapshot {
  readonly students: readonly StudentPlacementFacts[];
  readonly drivesByStatus: Readonly<Record<string, number>>;
  readonly offersByCategory: Readonly<Record<string, number>>;
  readonly campuses: readonly CampusBreakdown[];
}

export interface DashboardView {
  snapshot(): Promise<DashboardSnapshot>;
}

const label = (value: string) => value.replaceAll("_", " ");

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
