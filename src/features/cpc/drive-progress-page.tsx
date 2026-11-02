import {
  ColumnFilterButton,
  ColumnFilterOptions,
  ColumnFilterSearch,
} from "@components/column-filter";
import { NoDriveMatches } from "@components/drive-search";
import { StudentIdentity } from "@components/student-identity";
import { Badge, Button, ButtonLink, Card, PageHeader } from "@components/ui";
import { visitAccent } from "@components/visit-accent";
import { VisitPane, type VisitPaneRole } from "@components/visit-pane";
import { countDistinctApplicants, groupDrivesByEvent } from "@domain/company-drive";
import { searchDrives } from "@domain/drive-portfolio";
import { driveStatusLabel, driveStatusTone } from "@domain/drive-status";
import {
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { offerCategoryLabelOf } from "@domain/offer-category";
import { describeOfferPay } from "@domain/offer-pay";
import type { AttendanceStatus, DriveType, RoundResult } from "@domain/types";
import { describeReadFailure } from "@lib/postgrest-read";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * D10 (2026-08-12): the placement coordinator and KAM follow students
 * through the ENTIRE cycle — shortlist, every round, the offer.
 *
 * Strictly read-only. Recording results is the Central CPC's (D8); attendance
 * has its own screen. RLS scopes everything here to the coordinator's / KAM's campuses,
 * so an empty screen means "no drives touch my students", not "no access".
 */

export interface StudentRoundProgress {
  readonly sequence: number;
  readonly name: string;
  readonly attendance: AttendanceStatus;
  readonly result: RoundResult | null;
}

export interface DriveProgressStudent {
  readonly applicationId: string;
  readonly studentId?: string | undefined;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly campusName?: string | undefined;
  readonly shortlisted: boolean;
  readonly rounds: readonly StudentRoundProgress[];
  readonly offer: {
    /** 0070: null on a plain internship, which records a stipend instead. */
    readonly ctcLpa: number | null;
    readonly stipendMonthly?: number | null;
    readonly driveType?: DriveType;
    readonly offerCategory: string | null;
  } | null;
}

export interface DriveProgressEntry {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  readonly status: string;
  readonly students: readonly DriveProgressStudent[];
  /** Multi-role grouping: the parent event ID (null for legacy standalone drives). */
  readonly companyDriveId?: string | null;
  /** Multi-role grouping: the event date. */
  readonly tentativeDate?: string | null;
}

export interface DriveProgressView {
  drives(): Promise<readonly DriveProgressEntry[]>;
}

const label = (value: string) => value.replaceAll("_", " ");

const RESULT_TONE = (result: RoundResult | null, attendance: AttendanceStatus) => {
  if (result === "selected") return "success" as const;
  if (result === "rejected") return "danger" as const;
  if (attendance === "absent") return "danger" as const;
  return "neutral" as const;
};

/**
 * A page is filled to a budget of ROLE ROWS, not a fixed number of visits.
 *
 * Ten visits used to mean ten rows for a screen of legacy drives and forty for
 * a visit that raised four roles, so the page was either half empty or three
 * screens tall. A budget keeps the page roughly one screen high; `15` fills a
 * laptop viewport, and the reader can ask for a taller or shorter page.
 */
const ROW_BUDGETS = [10, 15, 25, 50] as const;
const DEFAULT_ROW_BUDGET = 15;

/** The slice of the cycle a coordinator is asking about, held per role. */
type StageFilter = "all" | "shortlisted" | "in_rounds" | "offers";

/** One company visit: its group id and its roles, in their table order. */
type VisitGroup = readonly [string, readonly DriveProgressEntry[]];

/**
 * Pages of WHOLE visits, filled to a row budget.
 *
 * A visit is never split across pages: half a company on each page is the
 * "same company twice" this table was rebuilt to stop. When a single visit is
 * taller than the budget it is still shown whole, on a page of its own.
 */
function paginateVisits(events: readonly VisitGroup[], rowBudget: number): VisitGroup[][] {
  const pages: VisitGroup[][] = [];
  let page: VisitGroup[] = [];
  let rows = 0;

  for (const event of events) {
    const height = event[1].length;
    if (page.length > 0 && rows + height > rowBudget) {
      pages.push(page);
      page = [];
      rows = 0;
    }
    page.push(event);
    rows += height;
  }

  if (page.length > 0) pages.push(page);
  return pages;
}

interface RoleSelection {
  readonly college: string;
  readonly stage: StageFilter;
}

const UNFILTERED: RoleSelection = { college: "", stage: "all" };

const chipClass = (active: boolean, on: string, off: string) =>
  `rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
    active ? on : off
  }`;

const BRAND_ON = "bg-brand-500 text-white border-brand-600";
const BRAND_OFF = "bg-surface text-ink-700 border-line hover:bg-surface-muted";
const GOLD_OFF = "bg-surface text-gold-700 border-gold-300 hover:bg-gold-50";
const SUCCESS_ON = "bg-success-600 text-white border-success-700";
const SUCCESS_OFF = "bg-surface text-success-700 border-success-300 hover:bg-success-50";

/**
 * How far a set of applications has come. Every card on this page prints these
 * four counts, for one role or for a whole visit.
 *
 * A student who applied to two roles of one visit is ONE applicant, and the
 * student id is the only way to see that. When any row arrives without an id
 * the figure falls back to a head-count rather than mixing two measures.
 */
function countStage(applications: readonly DriveProgressStudent[]) {
  const ids = applications.flatMap((s) => (s.studentId === undefined ? [] : [s.studentId]));
  return {
    applicants:
      ids.length === applications.length
        ? countDistinctApplicants(ids.map((studentId) => ({ studentId })))
        : applications.length,
    shortlisted: applications.filter((s) => s.shortlisted).length,
    inRounds: applications.filter((s) => s.rounds.length > 0).length,
    offers: applications.filter((s) => s.offer !== null).length,
  };
}

const dayIn = (iso: string | null | undefined) =>
  iso === null || iso === undefined
    ? null
    : new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
      });

export function DriveProgressPage({ view }: { view: DriveProgressView }) {
  const [drives, setDrives] = useState<readonly DriveProgressEntry[] | null>(null);
  /** The read failed — said plainly, never drawn as an empty cycle. */
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DriveTypeFilterValue>("");
  const [page, setPage] = useState(1);
  /** How many role rows a page may hold. Whole visits only. */
  const [rowBudget, setRowBudget] = useState<number>(DEFAULT_ROW_BUDGET);
  /** The role whose students the pane is listing, and the visit it belongs to. */
  const [openPane, setOpenPane] = useState<{ eventId: string; driveId: string } | null>(null);
  /**
   * Where each role is being read, keyed by drive id so the choice survives
   * folding a role away and turning the page.
   */
  const [selection, setSelection] = useState<Record<string, RoleSelection>>({});

  const select = useCallback((driveId: string, next: Partial<RoleSelection>) => {
    setSelection((prev) => {
      const current = prev[driveId] ?? UNFILTERED;
      return { ...prev, [driveId]: { ...current, ...next } };
    });
  }, []);

  // "Try again" is a re-run trigger, not a value this body reads: left out of
  // the list, a refused read could never be retried without leaving the screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let ignore = false;
    setFailure(null);
    // A refused read is not a campus with no students. Before, the rejection
    // was dropped on the floor and the screen stayed on "Loading drives…" —
    // and a coordinator who waited long enough started calling students to ask
    // whether they had been left out of a round.
    view.drives().then(
      (next) => {
        if (!ignore) setDrives(next);
      },
      (cause: unknown) => {
        if (!ignore) setFailure(describeReadFailure(cause, "Your drives could not be read."));
      },
    );
    return () => {
      ignore = true;
    };
  }, [view, attempt]);

  // The domain's predicate, so "hcl" matches the same drives here as on every other list.
  const visible = useMemo(() => {
    if (drives === null) return [];
    return searchDrives(
      drives.filter((drive) => matchesDriveType(drive.driveType ?? null, type)),
      query,
    );
  }, [drives, query, type]);

  const driveTypeOptions = useMemo(() => {
    if (!drives) return [];
    const placementCount = drives.filter((d) => d.driveType === "placement").length;
    const convertibleCount = drives.filter((d) => d.driveType === "internship_convertible").length;
    const internshipCount = drives.filter((d) => d.driveType === "internship").length;
    return [
      { value: "placement", label: "Full time", count: placementCount },
      {
        value: "internship_convertible",
        label: "Internship (convertible)",
        count: convertibleCount,
      },
      { value: "internship", label: "Internship", count: internshipCount },
    ];
  }, [drives]);

  /**
   * One row group per company visit. A legacy drive with no event of its own
   * groups under its own drive id, so it stays the single-role visit it was.
   */
  const events = useMemo(() => [...groupDrivesByEvent(visible).entries()], [visible]);

  const pages = useMemo(() => paginateVisits(events, rowBudget), [events, rowBudget]);
  const pageCount = Math.max(1, pages.length);
  const current = Math.min(page, pageCount);
  const pageEvents = pages[current - 1] ?? [];
  const rowsOnPage = pageEvents.reduce((rows, [, roles]) => rows + roles.length, 0);
  const visitsBefore = pages
    .slice(0, current - 1)
    .reduce((visits, pageVisits) => visits + pageVisits.length, 0);

  const openGroup = openPane === null ? undefined : events.find(([id]) => id === openPane.eventId);
  const openRoles = openGroup?.[1];
  const openHead = openRoles?.[0];

  /**
   * Every datum on a row opens the same pane, but a count carries the question
   * it answered: show that role at that stage. A college narrowing is dropped
   * because a count is role-wide — a leftover college filter would show fewer
   * people than the number that was pressed.
   */
  const openAt = (eventId: string, driveId: string, stage?: StageFilter) => {
    setOpenPane({ eventId, driveId });
    if (stage !== undefined) {
      select(driveId, { stage, college: "" });
    }
  };

  return (
    <div>
      <PageHeader
        title="Drive progress"
        subtitle="Students and college-wise progress through every round to the offer. Read-only — results are recorded centrally."
      />

      {failure !== null ? (
        <Card className="p-6">
          <p role="alert" className="text-sm text-danger-700">
            {failure}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            No students are listed under it on purpose — a cycle that arrived in parts looks exactly
            like a student who was left out of a round.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setDrives(null);
              setAttempt((count) => count + 1);
            }}
          >
            Try again
          </Button>
        </Card>
      ) : drives === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading drives…
        </p>
      ) : drives.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No drives involve your students yet.</p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Company visits and their roles, and how far each role's students have come
                </caption>
                <thead>
                  <tr className="border-b border-line bg-surface-muted/60 text-xs uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="flex items-center gap-1.5">
                        Company
                        <ColumnFilterButton label="Company" active={query !== ""}>
                          <ColumnFilterSearch
                            label="Company"
                            value={query}
                            onChange={(q) => {
                              setQuery(q);
                              setPage(1);
                              setOpenPane(null);
                            }}
                            placeholder="Search company…"
                          />
                        </ColumnFilterButton>
                      </span>
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Role
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Applicants
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Shortlisted
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      In rounds
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      Offers
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      <span className="flex items-center gap-1.5">
                        Status
                        <ColumnFilterButton label="Drive type" active={type !== ""}>
                          <ColumnFilterOptions
                            label="Drive type"
                            options={driveTypeOptions}
                            selected={type === "" ? [] : [type]}
                            onChange={(next) => {
                              setType(next.length === 0 ? "" : (next[0] as DriveTypeFilterValue));
                              setPage(1);
                              setOpenPane(null);
                            }}
                          />
                        </ColumnFilterButton>
                      </span>
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                {visible.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={8} className="p-8 text-center">
                        <NoDriveMatches
                          query={query}
                          {...(type === "" ? {} : { typeLabel: driveTypeLabel(type) })}
                        />
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  pageEvents.map(([eventId, roles], index) => (
                    <VisitRows
                      key={eventId}
                      roles={roles}
                      accentIndex={visitsBefore + index}
                      onOpen={(driveId, stage) => openAt(eventId, driveId, stage)}
                    />
                  ))
                )}
              </table>
            </div>

            {visible.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-600">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Showing visits {visitsBefore + 1} to {visitsBefore + pageEvents.length} of{" "}
                    {events.length} · {rowsOnPage} {rowsOnPage === 1 ? "role row" : "role rows"}
                  </span>
                  <div className="ml-2 flex items-center gap-1">
                    <span className="text-ink-500">Rows:</span>
                    <select
                      aria-label="Rows per page"
                      value={rowBudget}
                      onChange={(e) => {
                        setRowBudget(Number(e.target.value));
                        setPage(1);
                      }}
                      className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-800"
                    >
                      {ROW_BUDGETS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={current === 1}
                    onClick={() => setPage(current - 1)}
                  >
                    Previous
                  </Button>
                  <span className="px-2 font-medium">
                    Page {current} of {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={current >= pageCount}
                    onClick={() => setPage(current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {openPane !== null && openRoles !== undefined && openHead !== undefined && (
            <VisitPane
              open
              onClose={() => setOpenPane(null)}
              company={openHead.companyName}
              description={dayIn(openHead.tentativeDate) ?? undefined}
              roles={paneRolesFor(openRoles, selection, select)}
              activeId={openPane.driveId}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * One company visit, one row group — 2026-10-16 (Karthik): "same company shows
 * as two". A visit that raised several roles keeps the company named once, in
 * a cell that spans its roles, and each role states its own counts, status and
 * `View`. A single-role visit is one row, and the company links to its one
 * record.
 *
 * Asked on 2026-10-31 to make this screen as simple as possible: the card
 * frames, band headers and repeated visit totals are gone, and what is left is
 * the table a coordinator reads down.
 */
function VisitRows({
  roles,
  accentIndex,
  onOpen,
}: {
  roles: readonly DriveProgressEntry[];
  accentIndex: number;
  /** `stage` is set when a count was pressed: open that role at that stage. */
  onOpen: (driveId: string, stage?: StageFilter) => void;
}) {
  const head = roles[0];
  if (head === undefined) return null;

  const accent = visitAccent(accentIndex);
  const isVisit = roles.length > 1;
  const when = dayIn(head.tentativeDate);

  // The type said once for the whole visit. A visit that mixes an internship
  // with a full-time role cannot pick one at random, so it says "Mixed types"
  // and each role carries its own tag below.
  const types = new Set(roles.map((role) => role.driveType ?? null));
  const [singleType] = types;
  const mixed = types.size > 1;

  const meta = [mixed ? "Mixed types" : driveTypeLabel(singleType ?? null)];
  if (when !== null) meta.push(when);
  if (isVisit) meta.push(`${roles.length} roles`);

  return (
    <tbody>
      {roles.map((drive, index) => {
        const own = countStage(drive.students);
        const roleLabel = drive.roleTitle ?? "this role";

        /** A count is a question; pressing it opens the people who answer it. */
        const stageButton = (value: number, stage: StageFilter, description: string) => (
          <button
            type="button"
            aria-label={`Open the ${description} of ${roleLabel}`}
            onClick={() => onOpen(drive.driveId, stage)}
            className="rounded px-1.5 py-0.5 font-semibold text-ink-900 tabular-nums transition-colors hover:bg-brand-50 hover:text-brand-700 hover:underline"
          >
            {value}
          </button>
        );

        return (
          <tr
            key={drive.driveId}
            className="border-t border-line align-top hover:bg-surface-muted/30"
          >
            {index === 0 && (
              <th
                scope={isVisit ? "rowgroup" : "row"}
                rowSpan={roles.length}
                className="px-4 py-3 text-left align-top"
              >
                <span className="flex min-w-44 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${accent.dot}`}
                  />
                  <span className="min-w-0">
                    <span className="block font-heading font-bold text-ink-900">
                      {/* The company opens the visit pane. A visit that raised
                          several roles has no single record to pick, and the
                          pane carries each role's own View to /drives/:id —
                          the route to the record stays one deliberate press. */}
                      <button
                        type="button"
                        aria-label={`Open ${head.companyName} in the side pane`}
                        onClick={() => onOpen(head.driveId)}
                        className="text-left transition-colors hover:text-brand-600 hover:underline"
                      >
                        {head.companyName}
                      </button>
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-ink-500">
                      {meta.join(" · ")}
                    </span>
                  </span>
                </span>
              </th>
            )}
            <td className="px-3 py-3 font-medium text-ink-900">
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label={`Open ${roleLabel} in the side pane`}
                  onClick={() => onOpen(drive.driveId)}
                  className="text-left transition-colors hover:text-brand-700 hover:underline"
                >
                  {drive.roleTitle ?? "Role not set"}
                </button>
                {mixed && drive.driveType !== undefined && drive.driveType !== null ? (
                  <Badge tone={driveTypeTone(drive.driveType)}>
                    {driveTypeLabel(drive.driveType)}
                  </Badge>
                ) : null}
              </span>
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {stageButton(own.applicants, "all", "applicants")}
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {stageButton(own.shortlisted, "shortlisted", "shortlisted students")}
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {stageButton(own.inRounds, "in_rounds", "students in rounds")}
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {stageButton(own.offers, "offers", "students with an offer")}
            </td>
            <td className="px-3 py-3">
              <Badge tone={driveStatusTone(drive.status)}>{driveStatusLabel(drive.status)}</Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`View the students of ${
                  isVisit ? (drive.roleTitle ?? "this role") : head.companyName
                }`}
                onClick={() => onOpen(drive.driveId)}
              >
                View
              </Button>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

/** The pane's roles, each opened by its own tab and each owning its filters. */
function paneRolesFor(
  roles: readonly DriveProgressEntry[],
  selection: Record<string, RoleSelection>,
  onSelect: (driveId: string, next: Partial<RoleSelection>) => void,
): readonly VisitPaneRole[] {
  const types = new Set(roles.map((role) => role.driveType ?? null));
  const mixed = types.size > 1;

  return roles.map((drive) => {
    const applicants = countStage(drive.students).applicants;
    return {
      id: drive.driveId,
      label: drive.roleTitle ?? "Role not set",
      count: { value: applicants, unit: applicants === 1 ? "applicant" : "applicants" },
      badge:
        !mixed || drive.driveType === undefined || drive.driveType === null ? undefined : (
          <Badge tone={driveTypeTone(drive.driveType)}>{driveTypeLabel(drive.driveType)}</Badge>
        ),
      content: (
        <>
          <p className="mb-3">
            <ButtonLink
              variant="secondary"
              size="sm"
              to={`/drives/${drive.driveId}`}
              aria-label={`View ${drive.roleTitle ?? "this role"}`}
            >
              View
            </ButtonLink>
          </p>
          <RoleProgress
            drive={drive}
            selection={selection[drive.driveId] ?? UNFILTERED}
            onSelect={(next) => onSelect(drive.driveId, next)}
          />
        </>
      ),
    };
  });
}

/**
 * One role's cycle: who applied, and where each of them stands, college by
 * college. The filters belong to the role, not to the visit — a coordinator
 * reading VIT's shortlist for one role has said nothing about the others.
 */
function RoleProgress({
  drive,
  selection,
  onSelect,
}: {
  drive: DriveProgressEntry;
  selection: RoleSelection;
  onSelect: (next: Partial<RoleSelection>) => void;
}) {
  const selectedCollege = selection.college;
  const selectedStage = selection.stage;
  const totals = countStage(drive.students);

  // How many of this role's students each college holds. The stage counts used
  // to be printed per college as well, which said the same four numbers twice
  // over — once for the role, once again inside every card.
  const collegeCounts = new Map<string, number>();
  for (const student of drive.students) {
    const name = student.campusName ?? "All Campuses";
    collegeCounts.set(name, (collegeCounts.get(name) ?? 0) + 1);
  }

  const filteredStudents = drive.students.filter((s) => {
    if (selectedCollege !== "" && (s.campusName ?? "All Campuses") !== selectedCollege) {
      return false;
    }
    if (selectedStage === "shortlisted" && !s.shortlisted) return false;
    if (selectedStage === "in_rounds" && s.rounds.length === 0) return false;
    if (selectedStage === "offers" && s.offer === null) return false;
    return true;
  });

  return (
    <>
      {/* One strip, and the people come straight under it. The page is read for
          who is where, so the filters may not stack above the first name. */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-line px-4 py-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Stage in the cycle</legend>
          <span aria-hidden="true" className="text-xs font-semibold text-ink-500">
            Stage
          </span>
          <button
            type="button"
            aria-pressed={selectedStage === "all"}
            onClick={() => onSelect({ stage: "all" })}
            className={chipClass(selectedStage === "all", BRAND_ON, BRAND_OFF)}
          >
            {drive.students.length} Total Applicants
          </button>
          <button
            type="button"
            aria-pressed={selectedStage === "shortlisted"}
            onClick={() =>
              onSelect({ stage: selectedStage === "shortlisted" ? "all" : "shortlisted" })
            }
            className={chipClass(selectedStage === "shortlisted", BRAND_ON, BRAND_OFF)}
          >
            {totals.shortlisted} Shortlisted
          </button>
          <button
            type="button"
            aria-pressed={selectedStage === "in_rounds"}
            onClick={() => onSelect({ stage: selectedStage === "in_rounds" ? "all" : "in_rounds" })}
            className={chipClass(selectedStage === "in_rounds", BRAND_ON, GOLD_OFF)}
          >
            {totals.inRounds} In Rounds
          </button>
          <button
            type="button"
            aria-pressed={selectedStage === "offers"}
            onClick={() => onSelect({ stage: selectedStage === "offers" ? "all" : "offers" })}
            className={chipClass(selectedStage === "offers", SUCCESS_ON, SUCCESS_OFF)}
          >
            {totals.offers} Offers
          </button>
        </fieldset>

        {/* The colleges filter beside the stages, not above them: the two
            narrow the same list, and only their combination answers "whose
            shortlist is this". The old card grid repeated the stage counts per
            college and pushed the first name two screens down. */}
        {collegeCounts.size > 1 && (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">College</legend>
            <span aria-hidden="true" className="text-xs font-semibold text-ink-500">
              College
            </span>
            <button
              type="button"
              aria-pressed={selectedCollege === ""}
              onClick={() => onSelect({ college: "" })}
              className={chipClass(selectedCollege === "", BRAND_ON, BRAND_OFF)}
            >
              All Colleges
            </button>
            {[...collegeCounts.entries()].map(([name, applied]) => (
              <button
                key={name}
                type="button"
                aria-pressed={selectedCollege === name}
                onClick={() => onSelect({ college: selectedCollege === name ? "" : name })}
                className={chipClass(selectedCollege === name, BRAND_ON, BRAND_OFF)}
              >
                {name} <span className="opacity-70">{applied}</span>
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {/* Student list for this role / selected college */}
      <ul className="divide-y divide-line">
        {filteredStudents.length === 0 ? (
          <li className="p-4 text-xs text-ink-500 italic text-center">
            No students found for this filter.
          </li>
        ) : (
          filteredStudents.map((student) => (
            <li
              key={student.applicationId}
              className="flex flex-wrap items-start justify-between gap-4 p-4 hover:bg-surface-muted/20 transition-colors"
            >
              <div className="min-w-40">
                <StudentIdentity
                  name={student.studentName}
                  rollNumber={student.rollNumber}
                  college={student.campusName}
                  studentId={student.studentId}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                {student.shortlisted ? (
                  student.rounds.length === 0 ? (
                    <Badge tone="neutral">Shortlisted — no round yet</Badge>
                  ) : (
                    student.rounds.map((round) => (
                      <Badge
                        key={round.sequence}
                        tone={RESULT_TONE(round.result, round.attendance)}
                      >
                        Round {round.sequence} ·{" "}
                        {round.result !== null ? label(round.result) : label(round.attendance)}
                      </Badge>
                    ))
                  )
                ) : (
                  <Badge tone="neutral">Applied — not shortlisted</Badge>
                )}
                {student.offer !== null && (
                  <Badge tone="success">
                    Offer ·{" "}
                    {describeOfferPay({
                      driveType: student.offer.driveType ?? "placement",
                      ctcLpa: student.offer.ctcLpa,
                      stipendMonthly: student.offer.stipendMonthly ?? null,
                    })}
                    {student.offer.offerCategory !== null
                      ? ` · ${offerCategoryLabelOf(student.offer.offerCategory)}`
                      : ""}
                  </Badge>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
