import { Badge, Card, PageHeader, StatCard } from "@components/ui";
import { applicationWindow } from "@domain/drive-analytics";
import {
  type DriveRole,
  driveProgress,
  involvementIn,
  summariseFunnel,
} from "@domain/drive-portfolio";
import { type ApplicantRound, applicationProgress } from "@domain/student-progress";
import type { DriveStatus } from "@domain/types";
import { useEffect, useMemo, useState } from "react";

export interface PortfolioApplicant {
  readonly applicationId: string;
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
  readonly createdBy: string | null;
  readonly approvedBy: string | null;
  readonly publishedBy: string | null;
  readonly totalRounds: number;
  readonly roundsDecided: number;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  readonly applicants: readonly PortfolioApplicant[];
}

export interface PortfolioView {
  drives(): Promise<readonly PortfolioDrive[]>;
}

type Filter = "all" | "raised" | "approved";

const FILTERS: readonly { readonly value: Filter; readonly label: string }[] = [
  { value: "all", label: "All my drives" },
  { value: "raised", label: "Raised by me" },
  { value: "approved", label: "Approved by me" },
];

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
  /** Passed in, never read from the browser — see src/domain/drive-analytics. */
  now = new Date(),
}: {
  view: PortfolioView;
  profileId: string;
  title: string;
  now?: Date;
}) {
  const [drives, setDrives] = useState<readonly PortfolioDrive[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

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
  }, [view]);

  const visible = useMemo(
    () =>
      (drives ?? []).filter((drive) => {
        if (filter === "all") return true;
        return involvementIn(drive, profileId).includes(filter);
      }),
    [drives, filter, profileId],
  );

  if (failed) {
    return (
      <p role="alert" className="rounded-card bg-danger-50 p-4 text-sm text-danger-700">
        We could not load your drives. Refresh the page, or try again shortly.
      </p>
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
        subtitle="Every drive you raised, approved or published — and what has become of it."
      />

      {drives.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No drives yet. A drive appears here as soon as you raise or approve one.
          </p>
        </Card>
      ) : (
        <>
          <fieldset className="mb-6">
            <legend className="sr-only">Filter drives</legend>
            <div role="radiogroup" aria-label="Filter drives" className="flex flex-wrap gap-2">
              {FILTERS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === option.value
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-line bg-surface text-ink-700 hover:border-brand-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="drive-filter"
                    className="sr-only"
                    checked={filter === option.value}
                    onChange={() => setFilter(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {visible.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-ink-700">
                No drives match this filter. Try “All my drives”.
              </p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {visible.map((drive) => {
                const progress = driveProgress(drive);
                const funnel = summariseFunnel(drive.applicants);
                const window = applicationWindow(
                  {
                    start:
                      drive.applicationStart === null ? null : new Date(drive.applicationStart),
                    end: drive.applicationEnd === null ? null : new Date(drive.applicationEnd),
                  },
                  now,
                );
                const hats = involvementIn(drive, profileId);
                const open = expanded === drive.driveId;

                return (
                  <li key={drive.driveId}>
                    <Card className="overflow-hidden">
                      <section aria-label={drive.companyName} className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-heading text-lg font-bold text-ink-900">
                              {drive.companyName}
                            </p>
                            <p className="text-sm text-ink-500">{drive.roleTitle}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {hats.map((hat) => (
                                <Badge key={hat} tone="brand">
                                  {ROLE_LABEL[hat]}
                                </Badge>
                              ))}
                              <Badge tone={progress.terminal ? "neutral" : "warning"}>
                                {progress.phase}
                              </Badge>
                              {window.urgent && <Badge tone="danger">Closing soon</Badge>}
                              <Badge tone={window.state === "open" ? "success" : "neutral"}>
                                {window.label}
                              </Badge>
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
                              aria-label={`${drive.companyName} progress`}
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
                          aria-label={`${drive.companyName} applicants`}
                          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                        >
                          <StatCard label="Applied" value={funnel.applied} />
                          <StatCard label="Shortlisted" value={funnel.shortlisted} tone="brand" />
                          <StatCard label="In rounds" value={funnel.inRounds} tone="warning" />
                          <StatCard label="Offers" value={funnel.offers} tone="success" />
                          <StatCard label="Not selected" value={funnel.notSelected} />
                        </section>

                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : drive.driveId)}
                          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-brand-300"
                        >
                          {open ? "Hide" : "Show"} applicants to {drive.companyName}
                        </button>
                      </section>

                      {open && (
                        <section
                          aria-label={`${drive.companyName} applicant list`}
                          className="border-t border-line bg-surface-muted p-5"
                        >
                          {drive.applicants.length === 0 ? (
                            <p className="text-sm text-ink-700">
                              Nobody has applied yet. Applicants appear the moment they apply.
                            </p>
                          ) : (
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
                                        {applicant.studentName}
                                      </p>
                                      <p className="text-xs text-ink-500">
                                        <span>{applicant.rollNumber}</span> · {applicant.campus}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {applicant.shortlisted && (
                                        <Badge tone="brand">Shortlisted</Badge>
                                      )}
                                      <Badge tone={STAGE_TONE[stage.stage]}>{stage.label}</Badge>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </section>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
