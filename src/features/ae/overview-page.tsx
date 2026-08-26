import { Badge, Card, PageHeader, StatCard } from "@components/ui";
import { type AeApplicant, summariseAeDrives } from "@domain/ae-overview";
import { describeCtcRange } from "@domain/ctc";
import { orderDrives } from "@domain/drive-aging";
import { type PlacementCounts, summarisePlacementTotals } from "@domain/placement-totals";
import type { DriveStatus } from "@domain/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";

/**
 * The Account Executive's landing page. Mockup approved 2026-08-26.
 *
 * They had none: `/dashboard` is computed from the student roster, which an AE
 * cannot read (`0018`), so it would have greeted them with "No students yet.
 * Import a campus roster to begin."
 *
 * Two sections, and the difference between them is the whole design:
 *
 *  A. MY DRIVES — their own work, every card opening the drives behind it.
 *  B. PLACEMENT OVERALL — the organisation's numbers as AGGREGATES (0064).
 *     Nothing here links. The student directory is closed to an AE, and a
 *     card that opened an empty list would teach them the numbers are broken.
 */
export interface AeOverviewDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly status: DriveStatus;
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  readonly createdAt: string | null;
  readonly applicants: readonly AeApplicant[];
}

/** What `placement_totals()` returns. Counts only — never a student. */
export interface AeOrgTotals extends PlacementCounts {
  readonly highestLpa: number | null;
  readonly lowestLpa: number | null;
  readonly averageLpa: number | null;
  readonly medianLpa: number | null;
}

export interface AeOverviewSnapshot {
  readonly drives: readonly AeOverviewDrive[];
  readonly totals: AeOrgTotals;
}

export interface AeOverviewView {
  snapshot(): Promise<AeOverviewSnapshot>;
}

/** Money, as read aloud: "₹8 LPA", never "₹8.00 LPA". */
const lpa = (value: number | null) => (value === null ? "—" : `₹${value} LPA`);

const STATUS_LABEL: Partial<Record<DriveStatus, string>> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Yet to publish",
  live: "Applications open",
  applications_closed: "Applications closed",
  in_rounds: "In rounds",
  completed: "Completed",
  rejected: "Not approved",
};

const STATUS_TONE = (status: DriveStatus): "success" | "warning" | "neutral" =>
  status === "live" || status === "in_rounds"
    ? "success"
    : status === "completed" || status === "rejected"
      ? "neutral"
      : "warning";

/** How many of their recent drives the overview shows before deferring to Drives. */
const RECENT = 5;

export function AeOverviewPage({ view }: { view: AeOverviewView }) {
  const [snapshot, setSnapshot] = useState<AeOverviewSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    view
      .snapshot()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => {
        // Never an empty snapshot: "no drives" and "we could not ask" mean
        // opposite things, and only one of them is good news.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [view]);

  if (failed) {
    return (
      <div>
        <PageHeader title="My overview" />
        <p role="alert" className="rounded-card bg-danger-50 p-4 text-sm text-danger-700">
          We could not load your overview. Refresh the page, or try again shortly.
        </p>
      </div>
    );
  }

  if (snapshot === null) {
    return (
      <div>
        <PageHeader title="My overview" />
        <p role="status" className="text-sm text-ink-500">
          Loading your overview…
        </p>
      </div>
    );
  }

  const mine = summariseAeDrives(snapshot.drives);
  const org = summarisePlacementTotals(snapshot.totals);
  const recent = orderDrives(snapshot.drives, "newest").slice(0, RECENT);
  const hasPackages = snapshot.totals.highestLpa !== null;

  return (
    <div>
      <PageHeader
        title="My overview"
        subtitle="The drives you brought in, and how the placement year is going overall."
      />

      <section aria-label="My drives" className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg text-ink-900">My drives</h2>
          <p className="text-sm text-ink-500">Every card opens the drives behind it.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Link to="/central/drives/live" className="block">
            <StatCard label="Drives brought in" value={mine.broughtIn} tone="brand" />
          </Link>
          <Link to="/central/drives/live" className="block">
            <StatCard label="Live now" value={mine.liveNow} tone="success" />
          </Link>
          <Link to="/central/drives/live" className="block">
            <StatCard label="Applicants" value={mine.applicants} />
          </Link>
          <Link to="/central/drives/live" className="block">
            <StatCard label="Shortlisted" value={mine.shortlisted} />
          </Link>
          <Link to="/central/drives/completed" className="block">
            <StatCard label="Offers made" value={mine.offers} tone="warning" />
          </Link>
          <Link to="/central/drives/completed" className="block">
            <StatCard label="Drives completed" value={mine.completed} />
          </Link>
        </div>
      </section>

      <Card className="mb-6 p-5">
        <section aria-label="Most recent">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg text-ink-900">Most recent</h2>
            <p className="text-sm text-ink-500">Newest first — the whole list is under Drives.</p>
          </div>

          {recent.length === 0 ? (
            <p className="text-sm text-ink-700">
              No drives yet. Raise one with the Position information form and it appears here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-3 py-2">Drive</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Applied</th>
                    <th className="px-3 py-2">Shortlisted</th>
                    <th className="px-3 py-2">Offers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recent.map((drive) => {
                    const funnel = summariseAeDrives([drive]);
                    const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);
                    return (
                      <tr key={drive.driveId}>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-ink-900">
                            <Link to={`/drives/${drive.driveId}`} className="hover:underline">
                              {drive.companyName}
                            </Link>
                          </p>
                          <p className="text-xs text-ink-500">
                            {drive.roleTitle ?? "Role not specified"}
                            {ctc !== null && ` · ${ctc}`}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={STATUS_TONE(drive.status)}>
                            {STATUS_LABEL[drive.status] ?? drive.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-semibold text-ink-900">
                          {funnel.applicants}
                        </td>
                        <td className="px-3 py-3 font-semibold text-ink-900">
                          {funnel.shortlisted}
                        </td>
                        <td className="px-3 py-3 font-semibold text-ink-900">{funnel.offers}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Card>

      {/*
       * Section B. Figures only — no links, by design (spec §2). The rate is
       * `summarisePlacementTotals`, the same rule the Central CPC's screen
       * publishes, so an AE quoting it to a client quotes the organisation's
       * number rather than a second opinion.
       */}
      <section aria-label="Placement overall" className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg text-ink-900">Placement overall</h2>
          <p className="text-sm text-ink-500">
            The whole organisation · totals only, no student records.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label="Placement rate" value={`${org.placementRate}%`} tone="brand" />
          <StatCard
            label="Placed on campus"
            value={org.placed}
            hint={`of ${org.eligible} eligible`}
          />
          <StatCard label="Self-placed" value={org.selfPlaced} tone="warning" />
          <StatCard label="Opted out" value={org.optedOut} />
          <StatCard label="Eligible" value={org.eligible} />
          <StatCard label="Drives completed" value={org.completedDrives} hint="org-wide" />
        </div>
      </section>

      <Card className="p-5">
        <section aria-label="Package">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg text-ink-900">Package</h2>
            <p className="text-sm text-ink-500">One figure per placed student.</p>
          </div>

          {hasPackages ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Highest", snapshot.totals.highestLpa],
                ["Average", snapshot.totals.averageLpa],
                ["Median", snapshot.totals.medianLpa],
                ["Lowest", snapshot.totals.lowestLpa],
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
          ) : (
            <p className="text-sm text-ink-700">
              No packages yet. Figures appear as soon as the first offer is declared.
            </p>
          )}
        </section>
      </Card>
    </div>
  );
}
