import { DrilldownModal } from "@components/drilldown-modal";
import { Badge, Card, PageHeader, StatCard } from "@components/ui";
import { type AeApplicant, summariseAeDrives } from "@domain/ae-overview";
import { describeCtcRange } from "@domain/ctc";
import { orderDrives } from "@domain/drive-aging";
import {
  DRIVE_TYPE_FILTERS,
  type DriveTypeFilter,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { type PlacementCounts, summarisePlacementTotals } from "@domain/placement-totals";
import type { DriveStatus, DriveType } from "@domain/types";
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
  readonly driveType: DriveType | null;
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  readonly createdAt: string | null;
  /** The colleges the drive targets; empty means open to every campus. */
  readonly campuses: readonly string[];
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

/** Which number was clicked — each opens the drives behind it. */
type StatKind = "broughtIn" | "liveNow" | "applicants" | "shortlisted" | "offers" | "completed";

const STAT_TITLES: Record<StatKind, string> = {
  broughtIn: "Drives brought in",
  liveNow: "Open drives",
  applicants: "Applicants by drive",
  shortlisted: "Shortlisted by drive",
  offers: "Offers made",
  completed: "Drives completed",
};

function drivesBehindStat(
  kind: StatKind,
  drives: readonly AeOverviewDrive[],
): readonly AeOverviewDrive[] {
  /**
   * Only the drives that CONTRIBUTED, biggest first.
   *
   * "Offers made: 5" used to open every drive the AE has ever raised, sorted
   * by how many offers each produced — so a popup under a 5 opened twelve rows,
   * seven of them "0 offers". A list longer than the number that opened it reads
   * as the number being wrong, which it then is.
   */
  const byCount = (pick: (f: ReturnType<typeof summariseAeDrives>) => number) =>
    drives
      .filter((drive) => pick(summariseAeDrives([drive])) > 0)
      .sort(
        (a, b) =>
          pick(summariseAeDrives([b])) - pick(summariseAeDrives([a])) ||
          (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
  switch (kind) {
    case "broughtIn":
      return orderDrives(drives, "newest");
    case "liveNow":
      return drives.filter((d) => d.status === "live");
    case "completed":
      return drives.filter((d) => d.status === "completed");
    case "applicants":
      return byCount((f) => f.applicants);
    case "shortlisted":
      return byCount((f) => f.shortlisted);
    case "offers":
      return byCount((f) => f.offers);
  }
}

function StatDriveRow({ drive }: { drive: AeOverviewDrive }) {
  const funnel = summariseAeDrives([drive]);
  const ctc = describeCtcRange(drive.ctcMinLpa, drive.ctcMaxLpa);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">
            <Link to={`/drives/${drive.driveId}`} className="hover:underline">
              {drive.companyName}
            </Link>
          </p>
          <p className="text-sm text-ink-500">
            {drive.roleTitle ?? "Role not specified"}
            {ctc !== null && ` · ${ctc}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={driveTypeTone(drive.driveType)}>{driveTypeLabel(drive.driveType)}</Badge>
          <Badge tone={STATUS_TONE(drive.status)}>
            {STATUS_LABEL[drive.status] ?? drive.status}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {drive.campuses.length === 0
          ? "Open to every campus"
          : `Open to: ${drive.campuses.join(", ")}`}
      </p>
      <p className="mt-1 text-xs font-medium text-ink-700">
        {funnel.applicants} applied · {funnel.shortlisted} shortlisted · {funnel.offers} offers
      </p>
    </li>
  );
}

export function AeOverviewPage({ view }: { view: AeOverviewView }) {
  const [snapshot, setSnapshot] = useState<AeOverviewSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [openStat, setOpenStat] = useState<StatKind | null>(null);
  const [statTypeFilter, setStatTypeFilter] = useState<DriveTypeFilter>("");

  function showStat(kind: StatKind) {
    setStatTypeFilter("");
    setOpenStat(kind);
  }

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
  const statDrives = openStat === null ? [] : drivesBehindStat(openStat, snapshot.drives);
  const filteredStatDrives = statDrives.filter((d) =>
    matchesDriveType(d.driveType, statTypeFilter),
  );

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
          {(
            [
              ["broughtIn", "Drives brought in", mine.broughtIn, "brand"],
              ["liveNow", "Live now", mine.liveNow, "success"],
              ["applicants", "Applicants", mine.applicants, undefined],
              ["shortlisted", "Shortlisted", mine.shortlisted, undefined],
              ["offers", "Offers made", mine.offers, "warning"],
              ["completed", "Drives completed", mine.completed, undefined],
            ] as const
          ).map(([kind, label, value, tone]) => (
            <button
              key={kind}
              type="button"
              aria-haspopup="dialog"
              onClick={() => showStat(kind)}
              className="rounded-card text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <StatCard label={label} value={value} {...(tone !== undefined ? { tone } : {})} />
            </button>
          ))}
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
              <table className="w-full min-w-[540px] text-left text-sm">
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
                          <p className="max-w-[200px] truncate font-semibold text-ink-900">
                            <Link to={`/drives/${drive.driveId}`} className="hover:underline">
                              {drive.companyName}
                            </Link>
                          </p>
                          <p className="max-w-[200px] truncate text-xs text-ink-500">
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

      {openStat !== null && (
        // The header counts what the list below actually shows. It used to count
        // `statDrives` while rendering `filteredStatDrives`, so filtering the
        // popup by drive type left the number alone while the rows changed.
        <DrilldownModal
          eyebrow="My drives"
          title={STAT_TITLES[openStat]}
          subtitle={`${filteredStatDrives.length} drive${
            filteredStatDrives.length === 1 ? "" : "s"
          }`}
          onClose={() => setOpenStat(null)}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {DRIVE_TYPE_FILTERS.map((option) => {
              const count = statDrives.filter((d) =>
                matchesDriveType(d.driveType, option.value),
              ).length;
              const selected = statTypeFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatTypeFilter(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    selected
                      ? "bg-[#3D3777] text-white shadow-sm"
                      : "border border-line bg-surface text-ink-700 hover:border-brand-300"
                  }`}
                >
                  {option.label} ({count})
                </button>
              );
            })}
          </div>
          {filteredStatDrives.length === 0 ? (
            <p className="text-sm text-ink-700">No drives here yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {filteredStatDrives.map((drive) => (
                <StatDriveRow key={drive.driveId} drive={drive} />
              ))}
            </ul>
          )}
        </DrilldownModal>
      )}
    </div>
  );
}
