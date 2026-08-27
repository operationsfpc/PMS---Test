import { OfferLetterLink } from "@components/offer-letter-link";
import { Badge, Card, PageHeader } from "@components/ui";
import { searchDrives } from "@domain/drive-portfolio";
import {
  DRIVE_TYPE_FILTERS,
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import {
  CLOSING_FILTERS,
  type ClosingFilter,
  closesWithin,
  matchesLocation,
  parseLocations,
} from "@domain/student-drive-lists";
import type { DriveType, RoleCategory } from "@domain/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { DrivesList, type DrivesView, type OpenDrive } from "./drives-list";

/** An application still moving: the card wears its current round (N7). */
export interface ProgressDriveRow {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly roleCategory: RoleCategory;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  readonly locations: string;
  readonly appliedAt: string;
  readonly progressLabel: string;
  readonly roundsCleared: number;
  readonly totalRounds: number;
}

/** Applied and concluded: the outcome is the headline. */
export interface ConcludedDriveRow extends ProgressDriveRow {
  readonly outcomeLabel: string;
  /**
   * UAT 2026-08-27: the letter the CPC attached to the offer. Both halves
   * travel together — a name with no URL opens nothing.
   */
  readonly offerLetterUrl?: string | null;
  readonly offerLetterName?: string | null;
}

/** Never applied, chance gone: when it closed is the fact that matters. */
export interface ClosedDriveRow {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly roleCategory: RoleCategory;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  readonly ctcLabel: string;
  readonly locations: string;
  readonly closedOn: string;
}

export interface StudentDriveLists {
  readonly toApply: readonly OpenDrive[];
  readonly inProgress: readonly ProgressDriveRow[];
  readonly notApplied: readonly ClosedDriveRow[];
  readonly appliedClosed: readonly ConcludedDriveRow[];
  /**
   * C2 (UAT 2026-08-19): the rung the student already holds, or absent. A
   * placed student LOOKED locked out — the list quietly hid same-and-lower
   * drives and said nothing. The banner says what remains open instead.
   */
  readonly placedAt?: OfferCategory | null;
  /**
   * Q2 (UAT 2026-08-21): whether the one-internship allowance (R4) is used.
   * With the cap consumed, plain internship drives are hidden — the banner
   * must say so, or the "higher categories remain open" promise reads as a
   * lie the day an internship drive fails to appear.
   */
  readonly internshipCapConsumed?: boolean;
}

export interface StudentDriveListsView extends DrivesView {
  lists(): Promise<StudentDriveLists>;
}

const TABS = [
  { key: "to_apply", label: "To apply" },
  { key: "in_progress", label: "In progress" },
  { key: "not_applied_closed", label: "Not applied · closed" },
  { key: "applied_closed", label: "Applied · closed" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** One spelling per area. The PIF and SRF keep local copies; this is the student's. */
const AREA_LABEL: Record<RoleCategory, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

const CLOSING_LABEL: Record<ClosingFilter, string> = {
  any: "Any closing time",
  today: "Closes within 24 hours",
  "3_days": "Closes within 3 days",
  "7_days": "Closes within 7 days",
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

/**
 * N7 — the student's Drives area: four tabs, one drive in exactly one of
 * them, search and filters on every tab (approved mockup 2026-08-19).
 *
 * Mobile-first (PRD §21.2): stacked cards, controls that wrap, no tables.
 */
/**
 * Module-scoped so the default is ONE function. As a destructured default it
 * would be a new identity every render, and it sits in `useMemo` deps — the
 * Playwright journey caught the render loop that causes: the To-apply list
 * remounted continuously and the Apply confirmation could never be clicked.
 */
const wallClock = () => new Date();

export function DriveTabs({
  view,
  now = wallClock,
}: {
  view: StudentDriveListsView;
  now?: () => Date;
}) {
  const [lists, setLists] = useState<StudentDriveLists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("to_apply");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [area, setArea] = useState<"" | RoleCategory>("");
  const [type, setType] = useState<DriveTypeFilterValue>("");
  const [closing, setClosing] = useState<ClosingFilter>("any");

  const load = useCallback(async () => {
    try {
      setLists(await view.lists());
      setError(null);
    } catch {
      setError("Could not load your drives. Please try again.");
      setLists(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every location any visible drive names, for the filter's options. */
  const locationOptions = useMemo(() => {
    if (lists === null) return [];
    const all = [
      ...lists.toApply.map((d) => d.details.locations),
      ...lists.inProgress.map((d) => d.locations),
      ...lists.notApplied.map((d) => d.locations),
      ...lists.appliedClosed.map((d) => d.locations),
    ].flatMap((text) => parseLocations(text));
    return [...new Set(all)].sort((a, b) => a.localeCompare(b));
  }, [lists]);

  const matches = useCallback(
    (
      row: {
        companyName: string;
        roleTitle: string;
        roleCategory: RoleCategory;
        driveType?: DriveType | null;
      },
      loc: string,
    ) =>
      searchDrives([row], query).length > 0 &&
      matchesLocation(loc, location) &&
      (area === "" || row.roleCategory === area) &&
      // 2026-08-27 (Karthik): the same domain predicate the staff lists use.
      matchesDriveType(row.driveType ?? null, type),
    [query, location, area, type],
  );

  const filtered = useMemo(() => {
    if (lists === null) return null;
    return {
      toApply: lists.toApply.filter(
        (d) =>
          matches(d, d.details.locations) &&
          closesWithin(new Date(d.applicationEnd), now(), closing),
      ),
      inProgress: lists.inProgress.filter((d) => matches(d, d.locations)),
      notApplied: lists.notApplied.filter((d) => matches(d, d.locations)),
      appliedClosed: lists.appliedClosed.filter((d) => matches(d, d.locations)),
    };
  }, [lists, matches, closing, now]);

  const counts: Record<TabKey, number> = {
    to_apply: filtered?.toApply.length ?? 0,
    in_progress: filtered?.inProgress.length ?? 0,
    not_applied_closed: filtered?.notApplied.length ?? 0,
    applied_closed: filtered?.appliedClosed.length ?? 0,
  };

  /** Tab 1 reuses the full apply flow; its rows come from the loaded lists. */
  const toApplyView: DrivesView = useMemo(
    () => ({
      openDrives: async () => filtered?.toApply ?? [],
      apply: async (driveId, resume) => {
        await view.apply(driveId, resume);
        await load();
      },
    }),
    [filtered, view, load],
  );

  return (
    <>
      <PageHeader title="Drives" subtitle="Everything a drive can be to you, in four lists." />

      {lists?.placedAt != null && (
        <Card className="mb-4 border border-success-500/40 bg-success-50 p-4">
          <p className="text-sm text-ink-900">
            You are placed — <strong>{offerCategoryLabel(lists.placedAt)}</strong>. Drives in higher
            categories remain open to you and appear in “To apply” as they come.
            {lists.internshipCapConsumed === true && (
              <> Internship-only drives are closed — your one-internship allowance is used.</>
            )}
          </p>
        </Card>
      )}

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      <div role="tablist" aria-label="Your drives" className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === t.key
                ? "bg-[#3D3777] text-white"
                : "border border-line text-ink-700 hover:border-brand-300"
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search drives"
          placeholder="Company or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm sm:w-56"
        />
        <select
          aria-label="Filter by location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="rounded-lg border border-line px-2 py-2 text-sm"
        >
          <option value="">All locations</option>
          {locationOptions.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
        {/* 2026-08-27: a dropdown, not chips — this row is already dropdowns,
            and two filter idioms side by side read as two mechanisms. */}
        <select
          aria-label="Filter by drive type"
          value={type}
          onChange={(e) => setType(e.target.value as DriveTypeFilterValue)}
          className="rounded-lg border border-line px-2 py-2 text-sm"
        >
          {DRIVE_TYPE_FILTERS.map((option) => (
            <option key={option.value === "" ? "all" : option.value} value={option.value}>
              {option.value === "" ? "All types" : option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by role area"
          value={area}
          onChange={(e) => setArea(e.target.value as "" | RoleCategory)}
          className="rounded-lg border border-line px-2 py-2 text-sm"
        >
          <option value="">All role areas</option>
          {Object.entries(AREA_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {tab === "to_apply" && (
          <select
            aria-label="Filter by closing time"
            value={closing}
            onChange={(e) => setClosing(e.target.value as ClosingFilter)}
            className="rounded-lg border border-line px-2 py-2 text-sm"
          >
            {CLOSING_FILTERS.map((value) => (
              <option key={value} value={value}>
                {CLOSING_LABEL[value]}
              </option>
            ))}
          </select>
        )}
      </div>

      {lists === null && error === null ? (
        <p role="status" className="p-6 text-sm text-neutral-500">
          Loading your drives…
        </p>
      ) : filtered === null ? null : tab === "to_apply" ? (
        <div role="tabpanel" aria-label="To apply">
          {/* keyed so a filter change re-reads the adapter's rows */}
          <DrivesList
            key={`${query}|${location}|${area}|${closing}|${filtered.toApply.length}`}
            view={toApplyView}
            embedded
            now={now}
          />
        </div>
      ) : tab === "in_progress" ? (
        <div role="tabpanel" aria-label="In progress" className="flex flex-col gap-4">
          {filtered.inProgress.length === 0 ? (
            <Card className="p-6 text-sm text-ink-700">Nothing in progress right now.</Card>
          ) : (
            filtered.inProgress.map((row) => (
              <Card key={row.id} className="p-5">
                <RowHead row={row} />
                <p className="mt-2 text-sm">
                  Now in: <span className="font-semibold text-[#3D3777]">{row.progressLabel}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {row.roundsCleared} of {row.totalRounds} rounds cleared · applied{" "}
                  {day(row.appliedAt)}
                </p>
                <FullRecordLink id={row.id} company={row.companyName} />
              </Card>
            ))
          )}
        </div>
      ) : tab === "not_applied_closed" ? (
        <div role="tabpanel" aria-label="Not applied · closed" className="flex flex-col gap-4">
          {filtered.notApplied.length === 0 ? (
            <Card className="p-6 text-sm text-ink-700">Nothing here — you missed no drive.</Card>
          ) : (
            filtered.notApplied.map((row) => (
              <Card key={row.id} className="p-5">
                <RowHead row={row} />
                <p className="mt-2 text-sm text-ink-700">
                  {row.ctcLabel} · Closed {day(row.closedOn)} — you didn’t apply{" "}
                  <Badge tone="neutral">Missed</Badge>
                </p>
                <FullRecordLink id={row.id} company={row.companyName} />
              </Card>
            ))
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Applied · closed" className="flex flex-col gap-4">
          {filtered.appliedClosed.length === 0 ? (
            <Card className="p-6 text-sm text-ink-700">No concluded applications yet.</Card>
          ) : (
            filtered.appliedClosed.map((row) => (
              <Card key={row.id} className="p-5">
                <RowHead row={row} />
                <p className="mt-2 text-sm">
                  Outcome:{" "}
                  <Badge tone={row.outcomeLabel === "Offer received" ? "success" : "neutral"}>
                    {row.outcomeLabel}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-ink-500">Applied {day(row.appliedAt)}</p>
                {/* UAT 2026-08-27: "Offer received" now hands over the letter
                    that says so. Filed by the CPC since 0062, shown to the
                    student it belongs to since never. */}
                <OfferLetterLink
                  url={row.offerLetterUrl}
                  name={row.offerLetterName}
                  className="mt-2"
                />
                <FullRecordLink id={row.id} company={row.companyName} />
              </Card>
            ))
          )}
        </div>
      )}
    </>
  );
}

function RowHead({
  row,
}: {
  row: {
    companyName: string;
    roleTitle: string;
    roleCategory: RoleCategory;
    driveType?: DriveType | null;
  };
}) {
  return (
    <>
      <h2 className="flex flex-wrap items-center gap-2 font-[Raleway] text-lg font-bold text-ink-900">
        {row.companyName}
        {/* 2026-08-27: the type, on every drive summary the student sees. */}
        {row.driveType !== undefined && row.driveType !== null && (
          <Badge tone={driveTypeTone(row.driveType)}>{driveTypeLabel(row.driveType)}</Badge>
        )}
      </h2>
      <p className="text-sm text-ink-500">
        {row.roleTitle} · {AREA_LABEL[row.roleCategory]}
      </p>
    </>
  );
}

/** N1: every card opens the drive's one canonical page. */
function FullRecordLink({ id, company }: { id: string; company: string }) {
  return (
    <p className="mt-3">
      <Link
        to={`/drives/${id}`}
        className="text-sm font-semibold text-[#3D3777] underline underline-offset-2"
      >
        View everything about {company}
      </Link>
    </p>
  );
}
