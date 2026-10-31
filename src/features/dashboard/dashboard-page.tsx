import { DrilldownModal } from "@components/drilldown-modal";
import { type DriveProgressStudentItem, DriveRoster } from "@components/drive-roster";
import { type DrilldownPerson, StatDrilldown } from "@components/stat-drilldown";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  ButtonLink,
  Card,
  RoundAction,
  StatCard,
} from "@components/ui";
import { VisitPane, type VisitPaneRole } from "@components/visit-pane";
import { groupDrivesByEvent } from "@domain/company-drive";
import { type PlacementCtc, summariseCtc, summariseCtcByCategory } from "@domain/ctc-statistics";
import { describeVisitDay } from "@domain/drive-aging";
import { applicationWindow, driveOutcome } from "@domain/drive-analytics";
import { type DriveFunnel, type DriveParticipation, driveFunnel } from "@domain/drive-funnel";
import { driveStatusLabel } from "@domain/drive-status";
import { driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import { sameMoney } from "@domain/math";
import { type OfferCategory, offerCategoryLabelOf } from "@domain/offer-category";
import { FUNNEL_STAGE_MATCH, registrationFunnel } from "@domain/registration-funnel";
import {
  computePlacementStats,
  countsInPlacementDenominator,
  hasOptedOut,
  isPlacedOnCampus,
  isSelfPlaced,
  type StudentPlacementFacts,
} from "@domain/statistics";
import type { DirectoryFilter } from "@domain/student-directory";
import type { DriveType, SrfStatus } from "@domain/types";
import { describeReadFailure } from "@lib/postgrest-read";
import { ArrowUpRight } from "lucide-react";
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
 *
 * The display fields (name, roll, course, CGPA) are here because a count that
 * opens a popup has to be able to NAME the people it counted. Before them, the
 * only thing a card could open was the whole student directory.
 */
export type DashboardStudent = StudentPlacementFacts & {
  readonly fullName: string;
  readonly rollNumber: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly cgpa: number | null;
  readonly srfStatus: SrfStatus;
  readonly hasApplied: boolean;
  /** F4: the campus switcher filters on this, so it must be per student. */
  readonly campusId: string;
  readonly campusName: string;
};

/**
 * A roster row as the count→who popup spells it.
 *
 * Kept free of a `status`: the popup says what the COUNT meant, and only the
 * page knows that. Where a list genuinely splits into populations — applied
 * here, not applied there — the caller passes its own words.
 */
function toPerson(student: DashboardStudent): DrilldownPerson {
  return {
    id: student.studentId,
    name: student.fullName,
    rollNumber: student.rollNumber,
    campus: student.campusName,
    programme: `${student.degree} ${student.branch}`,
    cgpa: student.cgpa,
  };
}

/**
 * Where this student got to, in the funnel's own words.
 *
 * Judged by the domain's stage predicates, so a row cannot say "Verified"
 * beside a funnel that did not count them at that stage.
 */
function stageOf(student: DashboardStudent): string {
  if (student.hasOnCampusPlacement) return "Placed";
  if (FUNNEL_STAGE_MATCH.verified(student)) return "Verified";
  if (FUNNEL_STAGE_MATCH.submitted(student)) return "Form submitted";
  return "Not submitted";
}

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
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly driveType: DriveType | null;
  readonly status: string;
  /** The multi-role event this drive is one role of; null when standalone. */
  readonly companyDriveId: string | null;
  readonly tentativeDate: string | null;
  readonly campusNames: readonly string[];
  readonly participation: DriveParticipation;
  readonly students?: readonly DriveProgressStudentItem[];
}

/** A row of the drive box: the snapshot plus the funnel its table prints. */
type DriveWithFunnel = DriveProgressSnapshot & { readonly funnel: DriveFunnel };

/** The visit the pane is reading, and the role the coordinator clicked. */
interface OpenVisit {
  readonly company: string;
  readonly roles: readonly DriveWithFunnel[];
  readonly activeId: string;
}

export interface LiveDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly driveType: DriveType;
  readonly companyDriveId: string | null;
  readonly tentativeDate: string | null;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  /** Students this drive is actually open to, judged by R5. */
  readonly eligible: number;
  readonly eligibleStudentIds: readonly string[];
  readonly applied: number;
  readonly appliedStudentIds: readonly string[];
  readonly offers: number;
  readonly offerStudentIds: readonly string[];
}

/** One drive behind a "Drives by status" count, for the drill-down popup. */
export interface StatusDriveItem {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly status: string;
  readonly driveType: DriveType | null;
  readonly companyDriveId: string | null;
  readonly tentativeDate: string | null;
  /** The colleges the drive targets; empty means open to every campus. */
  readonly campuses: readonly string[];
}

/**
 * One offer category and the STUDENTS whose placement record sits in it.
 *
 * It used to be a `Record<string, number>` of OFFER ROWS, so a student holding
 * two Dream offers was counted twice here while the placed figure and the
 * package table beside it — both read from the one placement record (R9) —
 * counted them once. Carrying the ids rather than the count is what lets the
 * row open the people it counted.
 */
export interface OfferCategoryCount {
  readonly category: string;
  readonly studentIds: readonly string[];
}

/**
 * Which campus(es) one snapshot is for. Read by the view, not the page: the
 * switcher used to narrow only the student rows, so the funnel was one campus
 * while the packages, the open drives and the drive box were the whole
 * organisation — two cohorts quoted side by side on one screen.
 */
export interface DashboardScope {
  readonly campusIds?: readonly string[];
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
  /** The drives behind `drivesByStatus`, for the drill-down popup. */
  readonly statusDrives: readonly StatusDriveItem[];
  readonly offerCategories: readonly OfferCategoryCount[];
  readonly campuses: readonly CampusBreakdown[];
  /** F5: the drive-specific box. Empty until a drive has an audience. */
  readonly driveProgress: readonly DriveProgressSnapshot[];
}

export interface DashboardView {
  snapshot(scope?: DashboardScope): Promise<DashboardSnapshot>;
}

/** Money, as read aloud: "₹8 LPA", never "₹8.00 LPA". */
const lpa = (value: number | null) => (value === null ? "—" : `₹${value} LPA`);

const rate = (placed: number, eligible: number) =>
  eligible === 0 ? 0 : Math.round((placed / eligible) * 1000) / 10;

/**
 * One role of an open visit — its window, its take-up, its bar. The company is
 * said once above it, however many roles that visit raised, because a TCS with
 * three roles is one thing on the calendar and three things on the shortlist.
 */
function LiveDriveRole({
  drive,
  now,
  onTakeUp,
  onOffers,
}: {
  drive: LiveDrive;
  now: string;
  onTakeUp: (drive: LiveDrive) => void;
  onOffers: (drive: LiveDrive) => void;
}) {
  const window = applicationWindow(
    {
      start: drive.applicationStart === null ? null : new Date(drive.applicationStart),
      end: drive.applicationEnd === null ? null : new Date(drive.applicationEnd),
    },
    new Date(now),
  );
  const outcome = driveOutcome(drive);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {drive.roleTitle !== null && <p className="text-sm text-ink-500">{drive.roleTitle}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onTakeUp(drive)}>
              {drive.applied} of {drive.eligible} eligible
            </Button>
            applied
          </span>
          <span className="font-semibold text-ink-900">{outcome.applicationRate}%</span>
          <Button size="sm" variant="ghost" onClick={() => onOffers(drive)}>
            {drive.offers} offers
          </Button>
        </div>

        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full bg-brand-500" style={{ width: `${outcome.applicationRate}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {window.urgent && <Badge tone="danger">Closing soon</Badge>}
        <Badge tone={window.state === "open" ? "brand" : "neutral"}>{window.label}</Badge>
      </div>
    </div>
  );
}

/**
 * F4: all campuses by default, one campus on request.
 *
 * Kept OUT of the page body so it survives the re-read that switching triggers
 * — a picker that unmounts mid-switch loses the reader's focus and, if the
 * campus list came only from the scoped snapshot, collapses to the one campus
 * already chosen.
 */
function CampusPicker({
  campuses,
  value,
  onChange,
}: {
  campuses: readonly CampusBreakdown[];
  value: string;
  onChange: (campusId: string) => void;
}) {
  const name = campuses.find((campus) => campus.campusId === value)?.campusName;

  if (campuses.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="campus-filter" className="text-sm font-medium text-ink-700">
        Campus
      </label>
      <select
        id="campus-filter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
      >
        <option value="">All campuses</option>
        {campuses.map((campus) => (
          <option key={campus.campusId} value={campus.campusId}>
            {campus.campusName}
          </option>
        ))}
      </select>
      {/* A filtered screen that does not say so is read as the whole org. */}
      {name !== undefined && <Badge tone="brand">Showing {name}</Badge>}
    </div>
  );
}

/**
 * The hour, then the person.
 *
 * Only the first name, because a campus manager's dashboard is a conversation
 * with one person at a desk, not a letter. Empty name is not an error — the
 * profile row may hold none — so the greeting still answers, just without one.
 */
function greetingOf(hour: number, name: string): string {
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name.split(" ")[0]?.trim();
  return first === undefined || first === "" ? part : `${part}, ${first}`;
}

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
export function DashboardPage({
  view,
  title,
  name = "",
}: {
  view: DashboardView;
  title: string;
  /**
   * The signed-in person, from the route that already holds the auth state.
   * Optional because a screen that greets nobody still has to work: the name is
   * decoration, every figure on this page is not.
   */
  name?: string;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  /**
   * The first, unscoped load: it owns the campus list the switcher is built
   * from, because the scoped one only ever contains the campus already chosen.
   */
  const [baseline, setBaseline] = useState<DashboardSnapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped by "Try again"; the campus switcher never needs it. */
  const [attempt, setAttempt] = useState(0);
  /** "" is every campus — the default the request asked for (F4). */
  const [campusId, setCampusId] = useState("");
  const [driveQuery, setDriveQuery] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("");

  /**
   * One scope, one snapshot. The switcher used to be a client-side filter over
   * the student rows only, so the funnel moved with the campus while the
   * package figures, the open drives and the drive box stayed at the whole
   * organisation — the same screen quoting two cohorts at once.
   */
  // "Try again" is a re-run trigger, not a value this body reads: left out of
  // the list, a failed read could only be retried by switching campus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let ignore = false;
    // Nulled first: a second cohort must not appear beside the first while the
    // new one is in flight.
    setSnapshot(null);
    setFailure(null);
    view.snapshot(campusId === "" ? {} : { campusIds: [campusId] }).then(
      (next) => {
        if (ignore) return;
        setSnapshot(next);
        setBaseline((current) => current ?? next);
      },
      (cause: unknown) => {
        // A read that fails used to resolve with `data: null` and render as
        // "No students yet" — an outage reported as an empty campus.
        if (!ignore) setFailure(describeReadFailure(cause, "The overview could not be read."));
      },
    );
    return () => {
      ignore = true;
    };
  }, [view, campusId, attempt]);

  /**
   * F4: "available both overall and campus-wise ... the ability to switch
   * between individual campuses to analyze the registration and placement
   * funnel for each campus separately."
   *
   * Filtered ONCE, here, and fed to both the funnel and the placement stats:
   * two filters would eventually disagree and the screen would quote two
   * different cohorts side by side. The view already scoped the read; this says
   * so again, so a campus's students cannot join the figures printed for it
   * even if a view ever ignores the scope it was given.
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
    (baseline ?? snapshot)?.campuses.find((c) => c.campusId === campusId)?.campusName ??
    "All campuses";

  /**
   * One choice per company, not per role: the box below folds a visit's roles
   * into one card, and an option list that named each role twice asked the
   * reader to pick between two rows of the same company.
   */
  const driveNames = useMemo(
    () =>
      [...new Set((snapshot?.driveProgress ?? []).map((d) => d.companyName))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [snapshot],
  );

  /** Every college any drive was opened to or on roster, for the drive box's filter. */
  const colleges = useMemo(
    () =>
      [
        ...new Set([
          ...((baseline ?? snapshot)?.campuses.map((c) => c.campusName) ?? []),
          ...(snapshot?.driveProgress ?? []).flatMap((d) => d.campusNames),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [baseline, snapshot],
  );

  const [drivePage, setDrivePage] = useState(1);
  const [openVisit, setOpenVisit] = useState<OpenVisit | null>(null);
  /** The status row opened in the drill-down popup; null while closed. */
  const [statusOpen, setStatusOpen] = useState<string | null>(null);
  /**
   * The student count that was pressed, and the people standing in it.
   *
   * Resolved at the click rather than re-derived on every render: the numbers
   * on this page only change when the snapshot is re-read, which cannot happen
   * while a popup covers the screen. So the list a card opens is provably the
   * list the card counted.
   */
  const [peopleOpen, setPeopleOpen] = useState<{
    readonly eyebrow: string;
    readonly title: string;
    readonly note: string | null;
    readonly href: string;
    readonly people: readonly DrilldownPerson[];
  } | null>(null);
  const DRIVES_PAGE_SIZE = 5;

  const drives = useMemo(() => {
    const query = driveQuery.trim().toLowerCase();
    return (snapshot?.driveProgress ?? [])
      .filter(
        (d) =>
          query === "" || d.driveName.toLowerCase().includes(query) || d.driveName === driveQuery,
      )
      .filter(
        (d) =>
          collegeFilter === "" ||
          d.campusNames.length === 0 ||
          d.campusNames.includes(collegeFilter),
      )
      .map((d) => ({ ...d, funnel: driveFunnel(d.participation) }));
  }, [snapshot, driveQuery, collegeFilter]);

  /**
   * One entry per company visit, so a two-role visit is not counted as two
   * drives in the box (UAT 2026-10-16: "same company shows as two").
   */
  const driveVisits = useMemo(() => [...groupDrivesByEvent(drives).entries()], [drives]);

  const totalDrivePages = Math.max(1, Math.ceil(driveVisits.length / DRIVES_PAGE_SIZE));
  const paginatedVisits = useMemo(
    () => driveVisits.slice((drivePage - 1) * DRIVES_PAGE_SIZE, drivePage * DRIVES_PAGE_SIZE),
    [driveVisits, drivePage],
  );

  const packages = useMemo(
    () => (snapshot === null ? null : summariseCtc(snapshot.placements)),
    [snapshot],
  );

  const packagesByCategory = useMemo(
    () => (snapshot === null ? [] : summariseCtcByCategory(snapshot.placements)),
    [snapshot],
  );

  /** What each placed student is paid, so a package popup can say it per row. */
  const ctcById = useMemo(
    () => new Map((snapshot?.placements ?? []).map((p) => [p.studentId, p.ctcLpa] as const)),
    [snapshot],
  );

  /** The students holding one of the snapshot's placement records. */
  function placedRows(where?: (record: PlacementCtc) => boolean) {
    const records = (snapshot?.placements ?? []).filter(
      (record) => where === undefined || where(record),
    );
    return rowsWithIds(records.map((record) => record.studentId));
  }

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

  const campusOptions = (baseline ?? snapshot)?.campuses ?? [];

  /**
   * The ids the snapshot counted — who applied, who holds which category —
   * joined to the roster rows that can name them.
   *
   * Joined against `cohort`, the same population every figure on the screen is
   * computed from. An id with no row here means the view scoped its counts and
   * its rows differently, and the popup then opens SHORTER than the number that
   * opened it — which is the report, not a hole to paper over.
   */
  function rowsWithIds(ids: readonly string[]): readonly DashboardStudent[] {
    const byId = new Map(cohort.map((student) => [student.studentId, student]));
    return ids.flatMap((id) => {
      const student = byId.get(id);
      return student === undefined ? [] : [student];
    });
  }

  /** Opens the people behind one of this page's counts of students. */
  function openStudents(count: {
    eyebrow: string;
    title: string;
    href: string;
    rows: readonly DashboardStudent[];
    /** One population's own words; omitted when every row is the same thing. */
    status?: (student: DashboardStudent) => string;
    /** Splits the list into filter tabs — "Applied" / "Not applied". */
    group?: (student: DashboardStudent) => string;
    note?: string | undefined;
    /** Which campus the list is for, when the row answers for its own. */
    where?: string;
  }) {
    // The campus in view belongs in the popup's own words: a figure pressed
    // while one campus is selected must not read as the whole organisation.
    const parts = [
      count.note,
      count.where === undefined
        ? campusId === ""
          ? undefined
          : `at ${campusName}`
        : `at ${count.where}`,
    ].filter((part) => part !== undefined);
    setPeopleOpen({
      eyebrow: count.eyebrow,
      title: count.title,
      href: count.href,
      note: parts.length === 0 ? null : parts.join(" · "),
      people: count.rows.map((student) => ({
        ...toPerson(student),
        status: count.status === undefined ? null : count.status(student),
        group: count.group === undefined ? null : count.group(student),
      })),
    });
  }

  /**
   * Who stands in an "N of M applied" line — one role, or a whole visit.
   *
   * A visit's roles share an audience, so the list holds a student once however
   * many roles they applied to, exactly as the line counts them. The tabs are
   * the point: the coordinator's next question is always who has NOT applied.
   */
  function openTakeUp(roles: readonly LiveDrive[], where: string) {
    const applied = new Set(roles.flatMap((drive) => drive.appliedStudentIds));
    const rows = rowsWithIds([...new Set(roles.flatMap((drive) => drive.eligibleStudentIds))]);
    openStudents({
      eyebrow: "Open drives",
      title: `Eligible at ${where}`,
      href: studentsLink({}),
      rows,
      status: (student) => (applied.has(student.studentId) ? "Applied" : "Not applied"),
      group: (student) => (applied.has(student.studentId) ? "Applied" : "Not applied"),
      note: `${rows.filter((student) => applied.has(student.studentId)).length} of ${
        rows.length
      } applied`,
    });
  }

  /** Who holds an offer at one role, or across a whole visit. */
  function openOffers(roles: readonly LiveDrive[], where: string) {
    const rows = rowsWithIds([...new Set(roles.flatMap((drive) => drive.offerStudentIds))]);
    openStudents({
      eyebrow: "Open drives",
      title: `Offers at ${where}`,
      href: studentsLink({ filter: "on_campus" }),
      rows,
      note: `${rows.length} student${rows.length === 1 ? "" : "s"} hold an offer here`,
    });
  }

  /**
   * The opening, drawn once for the loading, failed and loaded states alike.
   * A screen that repaints its own header as the data arrives reads as the
   * page changing under the reader.
   *
   * `title` rides inside the single h1: a greeting alone is nobody's
   * dashboard, and a screen reader has to hear WHICH overview this is before
   * it hears the figures under it.
   */
  const header = (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-full">
        <h1 className="font-heading text-hero font-light text-ink-900 break-words">
          {greetingOf(new Date().getHours(), name)}
          <span className="mt-1 block text-sm font-semibold text-ink-500">{title}</span>
        </h1>
        <p className="mt-2 text-sm text-ink-500 break-words">
          Opt-outs leave the denominator; self-placed is its own line.
        </p>
      </div>

      {/* F4: all campuses by default, one campus on request. */}
      <CampusPicker campuses={campusOptions} value={campusId} onChange={setCampusId} />
    </div>
  );

  if (snapshot === null) {
    return (
      <div>
        {header}
        {failure === null ? (
          <p role="status" className="text-sm text-ink-500">
            Loading…
          </p>
        ) : (
          <Card className="p-6">
            <p className="text-sm font-medium text-danger-700" role="alert">
              {failure}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              This overview reads the roster, the offers and the drives together. Showing the part
              that did arrive would put a number on the screen that does not add up, so nothing is
              shown until the whole read works.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Try again
            </Button>
          </Card>
        )}
      </div>
    );
  }

  // Exactly the drives behind the clicked count — no extra filtering, or the
  // popup would open longer than the number that opened it.
  const statusOpenDrives = snapshot.statusDrives.filter((d) => d.status === statusOpen);
  // …and grouped the way the count is: one company visit per row, its roles
  // named underneath. `drivesByStatus` counts visits, so this list must too.
  const statusOpenEvents = [...groupDrivesByEvent(statusOpenDrives).values()];

  const rolesByStatus: Record<string, number> = {};
  for (const drive of snapshot.statusDrives) {
    rolesByStatus[drive.status] = (rolesByStatus[drive.status] ?? 0) + 1;
  }

  /** One entry per company visit — the list and the "open now" hint both read this. */
  const openEvents = [...groupDrivesByEvent(snapshot.liveDrives).values()];

  /** The college the roster lists: the filter box, else the campus in view. */
  const rosterCollege =
    collegeFilter === "" && campusName !== "All campuses" ? campusName : collegeFilter;

  /** The students the campus and college filters leave on one role of a visit. */
  function rosterOf(drive: DriveWithFunnel) {
    return (drive.students ?? [])
      .filter((s) => campusId === "" || s.campusId === campusId)
      .filter((s) => collegeFilter === "" || s.campusName === collegeFilter);
  }

  /**
   * One tab per role the visit raised, each holding its own students. The
   * company is said once, in the pane's header: roles are not the same thing
   * as companies, and a roster under the wrong company name is how a
   * coordinator ends up phoning the wrong drive.
   */
  function paneRoles(visit: OpenVisit): readonly VisitPaneRole[] {
    const mixed = new Set(visit.roles.map((role) => role.driveType)).size > 1;
    return visit.roles.map((role) => {
      const roster = rosterOf(role);
      return {
        id: role.driveId,
        label: role.roleTitle ?? "Role not set",
        count: { value: roster.length, unit: roster.length === 1 ? "student" : "students" },
        badge: mixed ? (
          <Badge tone={driveTypeTone(role.driveType)}>{driveTypeLabel(role.driveType)}</Badge>
        ) : undefined,
        content: (
          <>
            <p className="mb-3">
              <ButtonLink
                size="sm"
                variant="ghost"
                to={`/drives/${role.driveId}`}
                aria-label={`View ${role.driveName}`}
              >
                View
              </ButtonLink>
            </p>
            <DriveRoster students={roster} collegeFilter={rosterCollege} />
          </>
        ),
      };
    });
  }

  return (
    <div>
      {header}

      {snapshot.students.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            {campusId === ""
              ? "No students yet. Import a campus roster to begin."
              : `No students at ${campusName} yet. Every other campus is still on the list above.`}
          </p>
        </Card>
      ) : (
        <>
          {/* 2026-10-16: these cards open the students they counted, in place.
              They used to navigate to the directory, which asked the reader to
              leave the number they were questioning to go and check it
              somewhere else — and the directory's own filter did not always
              hold the same population ("if it shows a count I need to know who
              all is there"). The directory stays one click away in the footer.
              Readouts, not tiles: five bordered boxes compete with the panels
              under them, and the only thing the row has to say is the five
              figures. The hairlines divide them without framing them. */}
          <section
            aria-label="Headline"
            className="mb-8 grid grid-cols-2 gap-y-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line/70"
          >
            <StatCard
              label="Placement rate"
              value={`${stats.placementRate}%`}
              tone="brand"
              variant="readout"
              onClick={() =>
                openStudents({
                  eyebrow: "Headline",
                  // The rate is a fraction, so the popup shows the WHOLE
                  // fraction: who is in the denominator, and where each of them
                  // stands. Opted-out students are not here — they left the
                  // denominator, and the card above that one names them.
                  title: "In the placement denominator",
                  href: studentsLink({}),
                  rows: cohort.filter(countsInPlacementDenominator),
                  status: (student) => (student.hasOnCampusPlacement ? "Placed" : "Not placed"),
                  group: (student) => (student.hasOnCampusPlacement ? "Placed" : "Not placed"),
                  note: `${stats.placed} of ${stats.eligible} placed`,
                })
              }
            />
            <StatCard
              label="Placed on campus"
              value={stats.placed}
              hint={`of ${stats.eligible} eligible`}
              tone="success"
              variant="readout"
              onClick={() =>
                openStudents({
                  eyebrow: "Headline",
                  title: "Placed on campus",
                  href: studentsLink({ filter: "on_campus" }),
                  rows: cohort.filter(isPlacedOnCampus),
                  note: `of ${stats.eligible} eligible`,
                })
              }
            />
            <StatCard
              label="Self-placed"
              value={stats.selfPlaced}
              tone="warning"
              variant="readout"
              onClick={() =>
                openStudents({
                  eyebrow: "Headline",
                  title: "Self-placed",
                  href: studentsLink({ filter: "self_placed" }),
                  rows: cohort.filter(isSelfPlaced),
                  note: "their own find, never counted as an on-campus placement",
                })
              }
            />
            {/* Opt-outs leave the placement denominator, so the number they
                leave by is reported rather than quietly absorbed. */}
            <StatCard
              label="Opted out"
              value={stats.optedOut}
              tone="danger"
              variant="readout"
              onClick={() =>
                openStudents({
                  eyebrow: "Headline",
                  title: "Opted out",
                  href: studentsLink({ filter: "opted_out" }),
                  rows: cohort.filter(hasOptedOut),
                  note: "outside the placement denominator",
                })
              }
            />
            {/* The one card that is not about students, so it opens the drives
                instead - and the campus switcher does not apply to it. */}
            <StatCard
              label="Drives completed"
              value={snapshot.drivesByStatus.completed ?? 0}
              hint={`${openEvents.length} open now`}
              variant="readout"
              to="/central/drives/completed"
            />
          </section>

          {/*
           * Three panels across, each a different pastel, each answering one
           * question — where the cohort stands, what it earned, how the drives
           * are going. They used to be four equal white cards in two rows,
           * which made the funnel and the drive counts look like the same kind
           * of object. A tone says which queue is which before the title is
           * read, and the circle says there is a whole page behind it.
           */}
          <div className="mb-6 grid gap-5 lg:grid-cols-3">
            <Card tone="brand" className="p-5">
              {/* F5: renamed, because "funnel" promised a drive-by-drive story
                  it could not tell. These four are facts about a STUDENT. */}
              <section aria-label="Students overview">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg text-ink-900">Students overview</h2>
                    <p className="mt-1 text-sm text-ink-500">
                      Where the cohort is, from the roster to a signed offer.
                    </p>
                  </div>
                  <RoundAction label="Open the student directory" to="/central/students">
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </RoundAction>
                </div>
                <ol className="mt-3 space-y-2">
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
                        <button
                          type="button"
                          onClick={() =>
                            openStudents({
                              eyebrow: "Students overview",
                              title: stage.label,
                              // The directory still answers to the same
                              // population, one click further out.
                              href: studentsLink({ filter: FUNNEL_FILTER[stage.key] }),
                              rows: cohort.filter(FUNNEL_STAGE_MATCH[stage.key]),
                              status: stageOf,
                              // The first stage is everybody, so its share is
                              // always 100% and the line says nothing.
                              note:
                                stage.percentOfRoster === 100
                                  ? undefined
                                  : `${stage.percentOfRoster}% of the roster`,
                            })
                          }
                          className="block w-full rounded-control text-left transition-colors hover:bg-surface"
                        >
                          {row}
                        </button>
                        {/* The bar is the point: a stage that drops off a cliff
                          is visible before the numbers are read. */}
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface">
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

            <Card tone="warn" className="p-5">
              <section aria-label="Package">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg text-ink-900">Package</h2>
                  <RoundAction label="Open every offer and its package" to="/central/offers">
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </RoundAction>
                </div>
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
                          { name: "Highest", figure: packages.highestLpa },
                          { name: "Average", figure: packages.averageLpa },
                          { name: "Median", figure: packages.medianLpa },
                          { name: "Lowest", figure: packages.lowestLpa },
                        ].map(({ name, figure }) => {
                          // Somebody earns the highest and the lowest. The
                          // average is nobody's salary and the median of an
                          // even cohort is a midpoint between two — so those
                          // two open the placed list and SAY so, rather than
                          // landing the reader on a list of one or none.
                          const holders =
                            figure === null
                              ? []
                              : (snapshot?.placements ?? []).filter((p) =>
                                  sameMoney(p.ctcLpa, figure),
                                );
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() =>
                                openStudents({
                                  eyebrow: "Package",
                                  title: `${name} package ${lpa(figure)}`,
                                  href: packageLink(figure),
                                  rows: rowsWithIds(
                                    (holders.length === 0
                                      ? (snapshot?.placements ?? [])
                                      : holders
                                    ).map((p) => p.studentId),
                                  ),
                                  status: (student) => lpa(ctcById.get(student.studentId) ?? null),
                                  note:
                                    holders.length === 0
                                      ? `the ${name.toLowerCase()} of ${
                                          snapshot?.placements.length ?? 0
                                        } packages — not anybody's own salary`
                                      : `${holders.length} student${
                                          holders.length === 1 ? "" : "s"
                                        } at this package`,
                                })
                              }
                              className="block rounded-control bg-surface/70 p-3 text-left transition-colors hover:bg-surface"
                            >
                              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                                {name}
                              </dt>
                              <dd className="mt-0.5 font-heading text-lg font-bold text-ink-900">
                                {lpa(figure)}
                              </dd>
                            </button>
                          );
                        })}
                      </dl>
                    </section>

                    {packagesByCategory.length > 0 && (
                      <ul
                        aria-label="Package by category"
                        className="mt-4 divide-y divide-line border-t border-line"
                      >
                        {packagesByCategory.map(({ category, stats: byCategory }) => (
                          <li key={category}>
                            <button
                              type="button"
                              onClick={() =>
                                openStudents({
                                  eyebrow: "Package by category",
                                  title: offerCategoryLabelOf(category),
                                  href: studentsLink({ filter: "placed", category }),
                                  rows: placedRows((record) => record.category === category),
                                  status: (student) => lpa(ctcById.get(student.studentId) ?? null),
                                  note: `avg ${lpa(byCategory.averageLpa)} · high ${lpa(
                                    byCategory.highestLpa,
                                  )}`,
                                })
                              }
                              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-control py-2 pr-1 text-left text-sm transition-colors hover:bg-surface"
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
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            </Card>

            <Card tone="quiet" className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg text-ink-900">Drives by status</h2>
                  <p className="mt-1 text-xs text-ink-500">
                    Company visits, not role rows — a visit that raised three roles is one drive.
                  </p>
                </div>
                <RoundAction label="Open the drives list" to="/central/drives">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </RoundAction>
              </div>
              <ul className="mt-3 space-y-1">
                {Object.entries(snapshot.drivesByStatus).map(([status, count]) => {
                  const roles = rolesByStatus[status] ?? count;
                  const drives = `${count} drive${count === 1 ? "" : "s"}`;
                  return (
                    <li key={status}>
                      <button
                        type="button"
                        aria-label={
                          roles === count
                            ? `${driveStatusLabel(status)}: ${drives}`
                            : `${driveStatusLabel(status)}: ${drives}, ${roles} roles`
                        }
                        onClick={() => setStatusOpen(status)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="text-ink-700">{driveStatusLabel(status)}</span>
                          {roles !== count && (
                            <span className="text-xs text-ink-500">{roles} roles</span>
                          )}
                        </span>
                        <span className="font-semibold text-ink-900">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <Card tone="good" className="p-5">
              <section aria-label="Offers by category">
                <h2 className="text-lg text-ink-900">Offers by category</h2>
                {/* 2026-10-16: these are STUDENTS, each at the one offer that is
                    their placement record (R9) — the same population as the
                    placed count and the package table above. They used to count
                    offer rows, so one student holding two Dream offers was two
                    here and one everywhere else on the screen. */}
                <ul className="mt-3 space-y-2">
                  {snapshot.offerCategories.map(({ category, studentIds }) => (
                    <li key={category}>
                      <button
                        type="button"
                        onClick={() =>
                          openStudents({
                            eyebrow: "Offers by category",
                            title: `${offerCategoryLabelOf(category)} offers`,
                            href: studentsLink({
                              filter: "placed",
                              category: category as OfferCategory,
                            }),
                            rows: rowsWithIds(studentIds),
                            status: (student) => lpa(ctcById.get(student.studentId) ?? null),
                            note: "one student per placement record (R9)",
                          })
                        }
                        className="flex w-full justify-between rounded-lg py-1 pr-1 text-left text-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="text-ink-700">{offerCategoryLabelOf(category)}</span>
                        <span className="font-semibold text-ink-900">{studentIds.length}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </Card>

            <Card tone="quiet" className="p-5">
              <section aria-label="By campus">
                <h2 className="text-lg text-ink-900">By campus</h2>
                <ul className="mt-3 divide-y divide-line">
                  {snapshot.campuses.map((campus) => (
                    <li key={campus.campusId}>
                      {/* Its own campus, not the switcher's: this row is the
                          answer for THAT college. */}
                      <button
                        type="button"
                        onClick={() => {
                          const at = snapshot.students.filter(
                            (student) =>
                              student.campusId === campus.campusId &&
                              countsInPlacementDenominator(student),
                          );
                          openStudents({
                            eyebrow: "By campus",
                            title: `In the denominator at ${campus.campusName}`,
                            href: studentsLink({ campus: campus.campusName }),
                            rows: at,
                            status: (student) =>
                              student.hasOnCampusPlacement ? "Placed" : "Not placed",
                            group: (student) =>
                              student.hasOnCampusPlacement ? "Placed" : "Not placed",
                            note: `${rate(campus.placed, campus.eligible)}% placed`,
                            where: campus.campusName,
                          });
                        }}
                        className="flex w-full items-center justify-between gap-4 rounded-control py-2 pr-1 text-left text-sm transition-colors hover:bg-surface"
                      >
                        <span className="text-ink-800">{campus.campusName}</span>
                        <span className="text-ink-500">
                          {campus.placed} of {campus.eligible} ·{" "}
                          <span className="font-semibold text-ink-900">
                            {rate(campus.placed, campus.eligible)}%
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </Card>
          </div>

          <Card className="mb-6 p-5">
            <section aria-label="Open drives">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg text-ink-900">Open drives</h2>
                <RoundAction label="Open the live drives queue" to="/central/drives/live">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </RoundAction>
              </div>
              {openEvents.length === 0 ? (
                <p className="mt-3 text-sm text-ink-700">
                  No drives are open right now. Published drives appear here with the time left to
                  apply.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {openEvents.map((roles) => {
                    const head = roles[0];
                    if (head === undefined) return null;
                    // A student eligible for both roles, or applied to both, is
                    // one student at the visit — the same rule the count that
                    // opens the popup follows.
                    const eligible = new Set(roles.flatMap((drive) => drive.eligibleStudentIds));
                    const applied = new Set(roles.flatMap((drive) => drive.appliedStudentIds));

                    return (
                      <li key={head.driveId} className="py-3">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                          {head.companyName}
                          {roles.length > 1 && (
                            <span className="text-xs font-normal text-ink-500">
                              {roles.length} roles
                            </span>
                          )}
                        </p>

                        {roles.length > 1 && (
                          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openTakeUp(roles, head.companyName)}
                            >
                              {applied.size} of {eligible.size} students
                            </Button>
                            at this visit have applied to at least one role
                          </p>
                        )}

                        <div className={roles.length > 1 ? "mt-2 space-y-3" : ""}>
                          {roles.map((drive) => (
                            <LiveDriveRole
                              key={drive.driveId}
                              drive={drive}
                              now={snapshot.now}
                              onTakeUp={(role) =>
                                openTakeUp([role], role.roleTitle ?? role.companyName)
                              }
                              onOffers={(role) =>
                                openOffers([role], role.roleTitle ?? role.companyName)
                              }
                            />
                          ))}
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
          <Card className="p-5">
            <section aria-label="Drive progress">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg text-ink-900">Drive progress</h2>
                  <p className="mt-1 text-sm text-ink-500">
                    Eligible students, applications, and attendance and clearance in each round
                    through to the final offer.
                  </p>
                </div>
                {drives.length > 0 && (
                  <span className="text-xs font-medium text-ink-500">
                    Showing {Math.min((drivePage - 1) * DRIVES_PAGE_SIZE + 1, drives.length)}–
                    {Math.min(drivePage * DRIVES_PAGE_SIZE, drives.length)} of {drives.length}{" "}
                    drives
                  </span>
                )}
              </div>

              <div className="mt-4 mb-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="drive-name-filter"
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    Company
                  </label>
                  <select
                    id="drive-name-filter"
                    value={driveQuery}
                    onChange={(e) => {
                      setDriveQuery(e.target.value);
                      setDrivePage(1);
                    }}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">All companies</option>
                    {driveNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
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
                    onChange={(e) => {
                      setCollegeFilter(e.target.value);
                      setDrivePage(1);
                    }}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
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
                <div className="rounded-lg border border-dashed border-line p-6 text-center">
                  <p className="text-sm text-ink-700">
                    No drives match these filters yet. Published drives appear here as students
                    become eligible for them.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {paginatedVisits.map(([eventId, roles]) => {
                    const block = (drive: DriveWithFunnel, nested: boolean) => {
                      const driveStudents = (drive.students ?? []).filter(
                        (s) => campusId === "" || s.campusId === campusId,
                      );
                      const visibleStudents = driveStudents.filter(
                        (s) => collegeFilter === "" || s.campusName === collegeFilter,
                      );

                      return (
                        <div
                          className={
                            nested
                              ? ""
                              : "rounded-xl border border-line bg-surface p-4.5 shadow-xs transition-shadow hover:shadow-sm"
                          }
                        >
                          <header className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-line/60">
                            <section className="min-w-0">
                              {/* The visit already names the company and the role
                                already names itself, so a role folded inside a
                                visit hands over the record rather than
                                repeating both. */}
                              {nested ? (
                                <ButtonLink
                                  size="sm"
                                  variant="ghost"
                                  to={`/drives/${drive.driveId}`}
                                  aria-label={`View ${drive.driveName}`}
                                >
                                  View
                                </ButtonLink>
                              ) : (
                                <Link
                                  to={`/drives/${drive.driveId}`}
                                  className="font-semibold text-ink-900 text-base hover:text-brand-600 hover:underline transition-colors block"
                                >
                                  {drive.driveName}
                                </Link>
                              )}
                              <p className="mt-0.5 text-xs text-ink-500">
                                {drive.campusNames.length === 0
                                  ? "Open to every campus"
                                  : drive.campusNames.join(" · ")}
                              </p>
                            </section>
                            <section className="flex items-center gap-2">
                              <span className="rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                                {drive.funnel.stages.length} Funnel Stages
                              </span>
                            </section>
                          </header>

                          {/* Active students in ongoing drive preview & modal trigger */}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/30 px-3.5 py-2.5 border border-line/60">
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-semibold text-ink-700">
                                Students in this drive ({visibleStudents.length}):
                              </span>
                              {visibleStudents.length === 0 ? (
                                <span className="ml-2 text-xs text-ink-500 italic">
                                  No student applications recorded yet.
                                </span>
                              ) : (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {visibleStudents.slice(0, 4).map((s) => (
                                    <button
                                      key={s.applicationId}
                                      type="button"
                                      onClick={() =>
                                        setOpenVisit({
                                          company: drive.companyName,
                                          roles,
                                          activeId: drive.driveId,
                                        })
                                      }
                                      className="inline-flex items-center rounded-md bg-surface border border-line px-2 py-0.5 text-xs text-ink-800 hover:border-brand-400 hover:text-brand-600 cursor-pointer transition-colors"
                                      title={`View placement details for ${s.studentName}`}
                                    >
                                      {s.studentName}
                                    </button>
                                  ))}
                                  {visibleStudents.length > 4 && (
                                    <span className="text-xs text-ink-500 font-medium">
                                      +{visibleStudents.length - 4} more
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {visibleStudents.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setOpenVisit({
                                    company: drive.companyName,
                                    roles,
                                    activeId: drive.driveId,
                                  })
                                }
                              >
                                See all students
                              </Button>
                            )}
                          </div>

                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-xs font-semibold uppercase tracking-wider text-ink-500 border-b border-line/40">
                                  <th className="pb-2 font-medium">Stage</th>
                                  <th className="pb-2 font-medium text-right pr-4">Count</th>
                                  <th className="pb-2 font-medium">Performance / Attendance</th>
                                </tr>
                              </thead>
                              <tbody className="table-rows">
                                {drive.funnel.stages.map((stage) => {
                                  const round = drive.funnel.rounds.find(
                                    (r) => r.roundId === stage.key,
                                  );
                                  return (
                                    <tr key={stage.key}>
                                      <td className="py-2.5 pr-3 font-medium text-ink-800 text-xs sm:text-sm">
                                        <span className="block">
                                          <span className="text-ink-700">{stage.label}</span>
                                          {round !== undefined && (
                                            <span className="mt-0.5 block text-xs text-ink-500">
                                              <span>
                                                {round.present} of {round.scheduled} attended
                                              </span>{" "}
                                              · <span>{round.cleared} cleared</span> ·{" "}
                                              <span>{round.clearanceRate}% clearance</span>
                                              {round.unconfirmed > 0 && (
                                                <span> · {round.unconfirmed} unconfirmed</span>
                                              )}
                                            </span>
                                          )}
                                        </span>
                                      </td>
                                      <td className="py-2.5 pr-4 text-right font-semibold text-ink-900 text-xs sm:text-sm">
                                        {stage.count}
                                      </td>
                                      <td className="py-2.5 text-xs text-ink-500">
                                        {round !== undefined ? (
                                          <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-20 sm:w-28 overflow-hidden rounded-full bg-surface-muted">
                                              <div
                                                className="h-full bg-brand-500"
                                                style={{ width: `${round.clearanceRate}%` }}
                                              />
                                            </div>
                                            <span className="font-medium text-ink-700">
                                              {round.clearanceRate}%
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="text-ink-400">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    };

                    const [head] = roles;
                    if (head === undefined) return null;

                    if (roles.length === 1) {
                      return <div key={eventId}>{block(head, false)}</div>;
                    }

                    // The type said once for the visit; per role only when the
                    // visit mixes them and no single label is true.
                    const types = new Set(roles.map((role) => role.driveType));
                    const [singleType] = types;
                    const mixed = types.size > 1;

                    return (
                      <div
                        key={eventId}
                        className="rounded-xl border border-line bg-surface p-4.5 shadow-xs"
                      >
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                          {head.companyName}
                          {mixed ? (
                            <Badge tone="neutral">Mixed types</Badge>
                          ) : singleType !== undefined && singleType !== null ? (
                            <Badge tone={driveTypeTone(singleType)}>
                              {driveTypeLabel(singleType)}
                            </Badge>
                          ) : null}
                          <Badge tone="brand">{roles.length} roles</Badge>
                        </p>

                        <Accordion
                          multiple
                          className="mt-2"
                          defaultValue={roles.map((role) => role.driveId)}
                        >
                          {roles.map((role) => (
                            <AccordionItem key={role.driveId} value={role.driveId}>
                              <AccordionTrigger className="py-2">
                                <span className="font-semibold text-ink-900">
                                  {role.roleTitle ?? "Role not set"}
                                </span>
                                {mixed && (
                                  <Badge tone={driveTypeTone(role.driveType)}>
                                    {driveTypeLabel(role.driveType)}
                                  </Badge>
                                )}
                              </AccordionTrigger>
                              <AccordionContent className="pb-2">
                                {block(role, true)}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </div>
                    );
                  })}

                  {/* Pagination Controls */}
                  {totalDrivePages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
                      <p className="text-xs text-ink-500">
                        Page <span className="font-semibold text-ink-900">{drivePage}</span> of{" "}
                        <span className="font-semibold text-ink-900">{totalDrivePages}</span>
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDrivePage((p) => Math.max(1, p - 1))}
                          disabled={drivePage <= 1}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Previous
                        </button>
                        {Array.from({ length: totalDrivePages }, (_, i) => i + 1).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setDrivePage(p)}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              p === drivePage
                                ? "bg-brand-500 text-white"
                                : "border border-line text-ink-700 hover:bg-surface-muted"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setDrivePage((p) => Math.min(totalDrivePages, p + 1))}
                          disabled={drivePage >= totalDrivePages}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </Card>
        </>
      )}

      {peopleOpen !== null && (
        <StatDrilldown
          open
          onClose={() => setPeopleOpen(null)}
          eyebrow={peopleOpen.eyebrow}
          title={peopleOpen.title}
          people={peopleOpen.people}
          note={peopleOpen.note}
          href={peopleOpen.href}
        />
      )}

      {openVisit !== null && (
        <VisitPane
          open
          onClose={() => setOpenVisit(null)}
          company={openVisit.company}
          roles={paneRoles(openVisit)}
          activeId={openVisit.activeId}
        />
      )}

      {statusOpen !== null && (
        <DrilldownModal
          eyebrow="Campus overview"
          title={`Drives — ${driveStatusLabel(statusOpen)}`}
          subtitle={`${statusOpenEvents.length} drive${statusOpenEvents.length === 1 ? "" : "s"} · ${statusOpenDrives.length} role${statusOpenDrives.length === 1 ? "" : "s"}`}
          onClose={() => setStatusOpen(null)}
        >
          {statusOpenEvents.length === 0 ? (
            <p className="text-sm text-ink-500">No drives in this status right now.</p>
          ) : (
            <ul className="space-y-3">
              {statusOpenEvents.map((roles) => {
                const head = roles[0];
                if (head === undefined) return null;
                const campuses = [...new Set(roles.flatMap((drive) => drive.campuses))];
                // The visit day is the event's, and every drive card above
                // this popup says it — a count that opens without it loses the
                // one fact that separates two visits by the same company.
                const day = describeVisitDay(head.tentativeDate);
                return (
                  <li
                    key={head.driveId}
                    className="rounded-card border border-line bg-surface p-4 transition-shadow hover:shadow-sm"
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      {roles.length === 1 ? (
                        <Link
                          to={`/drives/${head.driveId}`}
                          className="font-medium text-ink-900 transition-colors hover:text-brand-700"
                        >
                          {head.companyName}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-900">{head.companyName}</span>
                      )}
                      {roles.length > 1 && (
                        <span className="text-xs text-ink-500">{roles.length} roles</span>
                      )}
                      {day !== null && <span className="text-xs text-ink-500">Visit on {day}</span>}
                    </p>
                    {/* Each role stays reachable: one visit is one row, but the
                        record pages are per role. */}
                    <ul className="mt-1 space-y-0.5 text-sm text-ink-500">
                      {roles.map((drive) => (
                        <li key={drive.driveId}>
                          <Link
                            to={`/drives/${drive.driveId}`}
                            className="transition-colors hover:text-brand-700"
                          >
                            {drive.roleTitle ?? "Role to be announced"}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-ink-500">
                      {campuses.length === 0
                        ? "Open to every campus"
                        : `Open to: ${campuses.join(", ")}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </DrilldownModal>
      )}
    </div>
  );
}
