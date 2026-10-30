import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  ButtonLink,
  Card,
  PageHeader,
} from "@components/ui";
import { groupByVisitKey, visitKey } from "@domain/company-drive";
import { searchDrives } from "@domain/drive-portfolio";
import {
  DRIVE_TYPE_FILTERS,
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { HOLD_KIND_LABELS, holdWindowLine } from "@domain/holds";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { matchesLocation, parseLocations } from "@domain/student-drive-lists";
import type { DriveType, HoldKind, RoleCategory } from "@domain/types";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { DrivesList, type DrivesView, type OpenDrive, visitAccent } from "./drives-list";

/** An application still moving: the card wears its current round (N7). */
export interface ProgressDriveRow {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly roleCategory: RoleCategory;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  /** The company visit this role belongs to; null for a legacy standalone drive. */
  readonly companyDriveId?: string | null;
  readonly locations: string;
  readonly appliedAt: string;
  readonly progressLabel: string;
  readonly roundsCleared: number;
  readonly totalRounds: number;
}

/**
 * The student's own unreleased hold (0125/0130), as their own screen says it.
 * The attachment is deliberately absent: it is the Campus Manager's evidence,
 * and the student is told the reason and the window in words.
 */
export interface StudentHoldNotice {
  readonly kind: HoldKind;
  readonly reason: string;
  /** ISO `YYYY-MM-DD`. */
  readonly startsAt: string;
  /** The review date — required since 0130, and never a switch. */
  readonly endsAt: string;
  /** Null while a self-placed request waits for its Campus Manager. */
  readonly confirmedAt: string | null;
}

export interface StudentDriveLists {
  readonly toApply: readonly OpenDrive[];
  readonly inProgress: readonly ProgressDriveRow[];
  /**
   * Present while the student is held or waiting for a hold request to be
   * confirmed. Absent for an adapter that never read it (tests, old callers).
   */
  readonly hold?: StudentHoldNotice | null;
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
  /**
   * R5/R6 answered for ONE drive, so the canonical record page offers the same
   * Apply the card does rather than deciding eligibility a second time.
   * Null when the drive is not visible to this student at all.
   */
  openDrive(driveId: string): Promise<OpenDrive | null>;
}

/**
 * 2026-10-29: two lists, not four. "Only show future drives" — a drive whose
 * window has closed is not one a student can act on, so it leaves this page
 * entirely; a concluded application is the dashboard's "My applications",
 * which carries the outcome and the offer letter.
 */
const TABS = [
  { key: "to_apply", label: "To apply" },
  { key: "in_progress", label: "In progress" },
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

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

/**
 * N7 — the student's Drives area: the lists they can still act on, search and
 * filters on each (approved mockup 2026-08-19; narrowed to future drives on
 * 2026-10-29).
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
      toApply: lists.toApply.filter((d) => matches(d, d.details.locations)),
      inProgress: lists.inProgress.filter((d) => matches(d, d.locations)),
    };
  }, [lists, matches]);

  const counts: Record<TabKey, number> = {
    to_apply: filtered?.toApply.length ?? 0,
    in_progress: filtered?.inProgress.length ?? 0,
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
      <PageHeader
        title="Drives"
        subtitle="Every drive still open to you, and every application still moving."
      />

      <HoldNotice hold={lists?.hold} now={now} />

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
        <Card className="mb-4 border border-danger-500 bg-danger-50 p-4">
          <p role="alert" className="text-sm text-danger-500">
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
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.key
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-line bg-surface text-ink-700 hover:border-violet-400"
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
      </div>

      {lists === null && error === null ? (
        <p role="status" className="p-6 text-sm text-ink-500">
          Loading your drives…
        </p>
      ) : filtered === null ? null : tab === "to_apply" ? (
        <div role="tabpanel" aria-label="To apply">
          {/* keyed so a filter change re-reads the adapter's rows */}
          <DrivesList
            key={`${query}|${location}|${area}|${filtered.toApply.length}`}
            view={toApplyView}
            embedded
            now={now}
          />
        </div>
      ) : (
        <div role="tabpanel" aria-label="In progress" className="flex flex-col gap-4">
          {filtered.inProgress.length === 0 ? (
            <Card className="p-6 text-sm text-ink-700">Nothing in progress right now.</Card>
          ) : (
            <TabVisits
              rows={filtered.inProgress}
              body={(row) => (
                <>
                  <p className="mt-2 text-sm">
                    Now in:{" "}
                    <span className="font-semibold text-brand-500">{row.progressLabel}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {row.roundsCleared} of {row.totalRounds} rounds cleared · applied{" "}
                    {day(row.appliedAt)}
                  </p>
                  <FullRecordLink id={row.id} role={row.roleTitle} company={row.companyName} />
                </>
              )}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * 0126 stops every mail to a held student, so this block is the only place
 * they are told why their drives went quiet. It says the kind, the reason and
 * the window — never the attachment, which is the Campus Manager's evidence.
 *
 * A pending request is a different sentence on purpose: nothing has changed
 * for the student yet, and a banner that read like a hold would make them stop
 * applying over a request the college has not answered.
 */
function HoldNotice({
  hold,
  now,
}: {
  hold: StudentHoldNotice | null | undefined;
  now: () => Date;
}) {
  if (hold === undefined || hold === null) return null;

  const pending = hold.confirmedAt === null;

  return (
    <Card
      className={`mb-4 border p-4 ${pending ? "border-brand-500/40 bg-brand-50" : "border-warning/40 bg-warning/5"}`}
    >
      <section aria-label="Placement hold">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-base font-bold text-ink-900">
            {pending ? "Waiting for your Campus Manager" : "Your placements are on hold"} —{" "}
            {HOLD_KIND_LABELS[hold.kind]}
          </h2>
          <Badge tone={pending ? "brand" : "warning"}>
            {pending ? "Awaiting confirmation" : "In force"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-ink-900">{hold.reason}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {holdWindowLine({ ...hold, releasedAt: null }, now())}
        </p>
        <p className="mt-2 text-sm text-ink-700">
          {pending
            ? "Until they confirm it, nothing changes — you can still apply, and every drive stays open to you."
            : "While this is in force you cannot apply to any drive, and the placement office stops mailing you. Only your Campus Manager can release it; the review date is a reminder, not a release."}
        </p>
      </section>
    </Card>
  );
}

/** What every tab's row owes the visit card it lives in. */
interface TabRow {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly roleCategory: RoleCategory;
  readonly driveType?: DriveType | null;
  readonly companyDriveId?: string | null;
}

/**
 * One card per company visit, whatever the tab (UAT 2026-10-16: a student with
 * two applications to one visit counted two companies).
 *
 * A single-role visit keeps the plain card it always had. Only a visit that
 * raised several roles folds, and its panels arrive open because the link to
 * the drive record is the reason the card exists.
 */
function TabVisits<T extends TabRow>({
  rows,
  body,
}: {
  rows: readonly T[];
  body: (row: T) => ReactNode;
}) {
  const groups = groupByVisitKey(rows, (row) => visitKey(row.companyDriveId, row.id));

  return (
    <>
      {[...groups.entries()].map(([eventId, roles], index) => {
        const head = roles[0];
        if (head === undefined) return null;
        const accent = visitAccent(index);

        if (roles.length === 1) {
          return (
            <Card key={eventId} className={`border-l-4 p-5 ${accent.rail}`}>
              <RowHead row={head} />
              {body(head)}
            </Card>
          );
        }

        const types = new Set(roles.map((role) => role.driveType ?? null));
        const [singleType] = types;
        const mixed = types.size > 1;

        return (
          <Card key={eventId} className={`border-l-4 p-5 ${accent.rail}`}>
            <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {head.companyName}
              </span>
              {/* Said once for the visit when every role shares a type; per role
                  underneath when it mixes, because picking one at random lies. */}
              {mixed ? <Badge tone="neutral">Mixed types</Badge> : null}
              {!mixed && singleType != null && (
                <Badge tone={driveTypeTone(singleType)}>{driveTypeLabel(singleType)}</Badge>
              )}
              <Badge tone="brand">{roles.length} roles</Badge>
            </h2>

            <Accordion multiple className="mt-2" defaultValue={roles.map((role) => role.id)}>
              {roles.map((role) => (
                <AccordionItem key={role.id} value={role.id}>
                  <AccordionTrigger className="py-2">
                    <span className="font-semibold text-ink-900">{role.roleTitle}</span>
                    <span className="text-sm font-normal text-ink-500">
                      {AREA_LABEL[role.roleCategory]}
                    </span>
                    {mixed && role.driveType != null && (
                      <Badge tone={driveTypeTone(role.driveType)}>
                        {driveTypeLabel(role.driveType)}
                      </Badge>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">{body(role)}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        );
      })}
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
      <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{row.companyName}</span>
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
/**
 * The row's way to the canonical drive record is one `View` control. The card
 * above it already names the company and the role, so the control says neither
 * twice — but both stay in the accessible name, because a student who pulls up
 * the page's list of links has to be able to tell one visit's roles from
 * another's.
 */
function FullRecordLink({ id, role, company }: { id: string; role: string; company: string }) {
  return (
    <p className="mt-3">
      {/* Drawn exactly as the `View` on the To-apply card, so one word never
          arrives in two shapes on one screen. */}
      <ButtonLink variant="ghost" to={`/drives/${id}`} aria-label={`View ${company} — ${role}`}>
        View
      </ButtonLink>
    </p>
  );
}
