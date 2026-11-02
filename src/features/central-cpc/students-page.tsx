import {
  ColumnFilterButton,
  ColumnFilterOptions,
  ColumnFilterSearch,
} from "@components/column-filter";
import { ErrorPanel } from "@components/error-panel";
import { HoldDialog, type HoldTarget } from "@components/hold-dialog";
import { TablePager } from "@components/table-pager";
import { Badge, Button, Card, PageHeader } from "@components/ui";
import { serialiseCsv } from "@domain/csv";
import { LADDER_CATEGORIES, type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { participationStatusLabel } from "@domain/participation-status";
import { describeResumeLinks } from "@domain/recruiter-export";
import {
  type DirectoryFilter,
  type DirectoryStudent,
  filterDirectory,
  summariseDirectory,
} from "@domain/student-directory";
import type { ParticipationStatus, SrfStatus } from "@domain/types";
import type { HoldsView } from "@lib/holds-view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

export interface StudentDirectoryView {
  students(): Promise<readonly DirectoryStudent[]>;
  /**
   * #79 (UAT 2026-10-18): the CV behind each row, for the CSV that leaves the
   * building. Keyed by STUDENT id. Optional so the directory still renders for
   * an older mock — absent means the column comes out empty, and the screen
   * says how many of them did.
   */
  resumeLinks?(studentIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Every student in the placement process, and what became of them.
 *
 * Asked for 2026-08-17. It is also the destination of the Placed count on the
 * placement overview: `?filter=placed` arrives here already filtered, because
 * a coordinator who has to filter again has been taken to the list rather than
 * to the breakdown they clicked.
 *
 * Read-only for everyone except a Campus Manager, who may hold one of their own
 * students (0125) — the row's badge is then the proof it landed. Verification
 * still lives with the campus coordinator and nothing here edits a record.
 */
const SRF_LABEL: Record<SrfStatus, string> = {
  invited: "Not started",
  registered: "In progress",
  srf_submitted: "Submitted",
  srf_approved: "Verified",
  srf_rejected: "Returned",
};

const SRF_TONE: Record<SrfStatus, "neutral" | "brand" | "warning" | "success" | "danger"> = {
  invited: "neutral",
  registered: "neutral",
  srf_submitted: "warning",
  srf_approved: "success",
  srf_rejected: "danger",
};

/**
 * 2026-08-26: one chip per population the placement overview can send here,
 * so a filter that arrives in the URL is always visible and always reversible.
 *
 * "Placed" and "Placed on campus" are deliberately both here and are NOT the
 * same list: "Placed" answers the coordinator's question - does this student
 * have a job - and includes self-placed students (C1); "Placed on campus" is
 * the figure PRD §16.2 reports and the overview prints.
 */
const FILTERS: readonly { readonly value: DirectoryFilter; readonly label: string }[] = [
  { value: "all", label: "All students" },
  { value: "submitted", label: "Form submitted" },
  { value: "verified", label: "Verified" },
  { value: "placed", label: "Placed" },
  { value: "on_campus", label: "Placed on campus" },
  { value: "self_placed", label: "Self-placed" },
  { value: "not_placed", label: "Not placed" },
  // 2026-10-29: the students the `idle` hold kind (0130) exists for — in
  // placements, unplaced, and never having applied to a single drive.
  { value: "never_applied", label: "Never applied" },
  { value: "opted_out", label: "Opted out" },
  // 2026-10-29: the roster's participation status is already shown on every
  // row, but the chip is the way a manager reaches the held students without
  // scrolling. The domain supports it; the chip was simply missing.
  { value: "on_hold", label: "On hold" },
];

/** The canonical order the two status dropdowns list their options in. */
const SRF_STATUSES: readonly SrfStatus[] = [
  "invited",
  "registered",
  "srf_submitted",
  "srf_approved",
  "srf_rejected",
];

const PARTICIPATION_STATUSES: readonly ParticipationStatus[] = ["active", "on_hold", "opted_out"];

const isSrfStatus = (value: string | null): value is SrfStatus =>
  SRF_STATUSES.some((status) => status === value);

const isParticipationStatus = (value: string | null): value is ParticipationStatus =>
  PARTICIPATION_STATUSES.some((status) => status === value);

const EXPORT_COLUMNS = [
  "Student",
  "Roll number",
  "Campus",
  "Degree",
  "Branch",
  "Passing year",
  "CGPA",
  "Registration",
  "Participation",
  "Applications",
  "Company",
  "Role",
  "CTC (LPA)",
  "Offer category",
  "Source",
  // #79: the directory export used to describe a student without carrying their
  // CV, so the coordinator had to open each record to send one.
  "Resume link",
] as const;

/** Real downloads go through a Blob; tests hand in a spy. */
function browserDownload(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const isFilter = (value: string | null): value is DirectoryFilter =>
  FILTERS.some((f) => f.value === value);

/**
 * Only the LADDER is drillable here. A placement record is never a plain
 * internship (R9), so `?category=internship` would draw a chip that can match
 * nobody — an empty list that reads as a fault rather than as an answer.
 */
const isCategory = (value: string | null): value is OfferCategory =>
  LADDER_CATEGORIES.some((c) => c === value);

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** A package figure from the URL. Nonsense is ignored, never shown as an empty list. */
function parseCtc(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const figure = Number(value);
  return Number.isFinite(figure) ? figure : undefined;
}

export function StudentDirectoryPage({
  view,
  holds,
  download = browserDownload,
}: {
  view: StudentDirectoryView;
  /**
   * The one write this page offers, and only a Campus Manager is handed it
   * (0125). Absent — as it is for every other role — draws no Hold button.
   */
  holds?: HoldsView;
  download?: (filename: string, text: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState<readonly DirectoryStudent[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumping this re-runs the one read below; the failure card used to only
  // tell the reader to refresh the whole page.
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);
  /** What the CSV actually carried, said once it is on its way. */
  const [exportNote, setExportNote] = useState<string | null>(null);
  /** The export failing — not the same complaint as the roster not loading. */
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  /** The student whose hold form is open. */
  const [holding, setHolding] = useState<HoldTarget | null>(null);
  /** Which student is now held, said once the write has landed. */
  const [holdNote, setHoldNote] = useState<string | null>(null);
  /** Students whose self-placed request is waiting on this manager (0130). */
  const [pending, setPending] = useState<readonly string[]>([]);
  /** The queue read failing — a request nobody can see is one nobody answers. */
  const [pendingProblem, setPendingProblem] = useState<string | null>(null);

  // The filter lives in the URL so the dashboard can link straight to a
  // breakdown, and so a coordinator can send someone the exact view they mean.
  const filterParam = params.get("filter");
  const selectedFilters: DirectoryFilter[] = useMemo(() => {
    if (!filterParam) return [];
    return filterParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is DirectoryFilter => isFilter(s) && s !== "all");
  }, [filterParam]);
  const _filter: DirectoryFilter =
    selectedFilters.length === 1 ? (selectedFilters[0] ?? "all") : "all";

  /**
   * The drill-downs the placement overview can arrive with, plus the roster
   * facts the table does not print as columns (2026-11-02). All in the URL for
   * the same reason as the filter, and all ignored when they are nonsense - a
   * mistyped parameter must not empty the screen.
   *
   * The text ones are validated against the options the roster actually
   * offers, below; validating against a list the screen draws is what keeps an
   * unrecognised value from narrowing the list with nothing on screen to
   * explain it.
   */
  const campusParam = params.get("campus") ?? "";
  const degreeParam = params.get("degree");
  const branchParam = params.get("branch");
  const yearParam = params.get("year");
  const srfParam = params.get("srf");
  const srfStatuses: SrfStatus[] = useMemo(() => {
    if (!srfParam) return [];
    return srfParam
      .split(",")
      .map((s) => s.trim())
      .filter(isSrfStatus);
  }, [srfParam]);
  const srfStatus: SrfStatus | undefined = srfStatuses.length === 1 ? srfStatuses[0] : undefined;
  const participationParam = params.get("participation");
  const ctc = parseCtc(params.get("ctc"));
  const categoryParam = params.get("category");
  const category = isCategory(categoryParam) ? categoryParam : undefined;

  const isPlacementFilter = useCallback(
    (f: string): f is DirectoryFilter =>
      f === "placed" || f === "on_campus" || f === "self_placed" || f === "not_placed",
    [],
  );

  const isRegistrationFilter = useCallback(
    (f: string): f is DirectoryFilter => f === "submitted" || f === "verified",
    [],
  );

  const selectedPlacementFilters = useMemo(
    () => selectedFilters.filter(isPlacementFilter),
    [selectedFilters, isPlacementFilter],
  );

  const selectedSrfForColumn = useMemo(() => {
    const result = [...srfStatuses];
    if (selectedFilters.includes("submitted") && !result.includes("srf_submitted")) {
      result.push("srf_submitted");
    }
    if (selectedFilters.includes("verified") && !result.includes("srf_approved")) {
      result.push("srf_approved");
    }
    return result;
  }, [srfStatuses, selectedFilters]);

  /** Changing one dimension must never silently drop the others. */
  const update = (next: Readonly<Record<string, string | undefined>>) => {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value === undefined || value === "") merged.delete(key);
          else merged.set(key, value);
        }
        return merged;
      },
      { replace: true },
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let live = true;
    view
      .students()
      .then((next) => {
        if (live) setStudents(next);
      })
      .catch(() => {
        // Never []: an empty roster and a broken query mean opposite things,
        // and only one of them is good news.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [view, attempt]);

  // The queue of requests waiting on this manager, read once for the roster
  // rather than once per row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the read on purpose
  useEffect(() => {
    if (holds === undefined) return;
    let live = true;
    holds
      .pendingIds()
      .then((ids) => {
        if (live) setPending(ids);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setPendingProblem(
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not check for requests waiting on you.",
        );
      });
    return () => {
      live = false;
    };
  }, [holds, attempt]);

  const campuses = useMemo(
    () => uniqueSorted((students ?? []).map((s) => s.campusName)),
    [students],
  );

  const _degrees = useMemo(() => uniqueSorted((students ?? []).map((s) => s.degree)), [students]);
  const _branches = useMemo(() => uniqueSorted((students ?? []).map((s) => s.branch)), [students]);
  const _passingYears = useMemo(
    () => [...new Set((students ?? []).map((s) => s.passingYear))].sort((a, b) => a - b),
    [students],
  );
  const srfOptions = useMemo(() => {
    const present = new Set((students ?? []).map((s) => s.srfStatus));
    return SRF_STATUSES.filter((status) => present.has(status));
  }, [students]);

  const _participationOptions = useMemo(() => {
    const present = new Set((students ?? []).map((s) => s.participationStatus));
    return PARTICIPATION_STATUSES.filter((status) => present.has(status));
  }, [students]);

  /*
   * An arriving value is honoured whenever it is a valid choice in the domain.
   */
  const campus = campusParam;
  const degree = degreeParam !== null && degreeParam.trim() !== "" ? degreeParam : "";
  const branch = branchParam !== null && branchParam.trim() !== "" ? branchParam : "";
  const yearFigure = yearParam === null ? null : Number(yearParam);
  const passingYear = yearFigure !== null && Number.isInteger(yearFigure) ? yearFigure : undefined;
  const participationStatus: ParticipationStatus | undefined = isParticipationStatus(
    participationParam,
  )
    ? participationParam
    : undefined;

  /**
   * Cross-synced faceted counts:
   * To show the correct count for options in dimension X, filter all students
   * by every active dimension EXCEPT dimension X.
   */
  const studentsForCampus = useMemo(
    () =>
      filterDirectory(students ?? [], {
        filters: selectedFilters.length > 0 ? selectedFilters : undefined,
        filter: selectedFilters.length === 0 ? "all" : undefined,
        query,
        degree,
        branch,
        passingYear,
        srfStatuses: srfStatuses.length > 0 ? srfStatuses : undefined,
        srfStatus,
        participationStatus,
        ctc,
        category,
      }),
    [
      students,
      selectedFilters,
      query,
      degree,
      branch,
      passingYear,
      srfStatuses,
      srfStatus,
      participationStatus,
      ctc,
      category,
    ],
  );

  const campusOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of studentsForCampus) {
      counts[s.campusName] = (counts[s.campusName] ?? 0) + 1;
    }
    return campuses
      .map((name) => ({
        value: name,
        label: name,
        count: counts[name] ?? 0,
      }))
      .sort((a, b) => {
        if (a.count > 0 !== b.count > 0) {
          return a.count > 0 ? -1 : 1;
        }
        return a.label.localeCompare(b.label);
      });
  }, [studentsForCampus, campuses]);

  const studentsForSrf = useMemo(
    () =>
      filterDirectory(students ?? [], {
        filters: selectedFilters.filter((f) => !isRegistrationFilter(f)),
        query,
        campus,
        degree,
        branch,
        passingYear,
        participationStatus,
        ctc,
        category,
      }),
    [
      students,
      selectedFilters,
      query,
      campus,
      degree,
      branch,
      passingYear,
      participationStatus,
      ctc,
      category,
      isRegistrationFilter,
    ],
  );

  const srfOptionsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of studentsForSrf) {
      counts[s.srfStatus] = (counts[s.srfStatus] ?? 0) + 1;
    }
    return srfOptions.map((status) => ({
      value: status,
      label: SRF_LABEL[status],
      count: counts[status] ?? 0,
    }));
  }, [studentsForSrf, srfOptions]);

  const studentsForPlacement = useMemo(
    () =>
      filterDirectory(students ?? [], {
        filters: selectedFilters.filter((f) => !isPlacementFilter(f)),
        query,
        campus,
        degree,
        branch,
        passingYear,
        srfStatuses: srfStatuses.length > 0 ? srfStatuses : undefined,
        srfStatus,
        participationStatus,
        ctc,
        category,
      }),
    [
      students,
      selectedFilters,
      query,
      campus,
      degree,
      branch,
      passingYear,
      srfStatuses,
      srfStatus,
      participationStatus,
      ctc,
      category,
      isPlacementFilter,
    ],
  );

  const placementOptions = useMemo(() => {
    let placed = 0;
    let notPlaced = 0;
    let onCampus = 0;
    let selfPlaced = 0;
    for (const s of studentsForPlacement) {
      if (s.placement !== null) {
        placed++;
        if (s.placement.source === "on_campus") onCampus++;
        if (s.placement.source === "self_placed") selfPlaced++;
      } else {
        notPlaced++;
      }
    }
    return [
      { value: "placed", label: "Placed (All)", count: placed },
      { value: "on_campus", label: "On-campus", count: onCampus },
      { value: "self_placed", label: "Self-placed", count: selfPlaced },
      { value: "not_placed", label: "Not placed", count: notPlaced },
    ];
  }, [studentsForPlacement]);

  const studentsForPopulation = useMemo(
    () =>
      filterDirectory(students ?? [], {
        query,
        campus,
        degree,
        branch,
        passingYear,
        srfStatuses: srfStatuses.length > 0 ? srfStatuses : undefined,
        srfStatus,
        participationStatus,
        ctc,
        category,
      }),
    [
      students,
      query,
      campus,
      degree,
      branch,
      passingYear,
      srfStatuses,
      srfStatus,
      participationStatus,
      ctc,
      category,
    ],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const opt of FILTERS) {
      counts[opt.value] = filterDirectory(studentsForPopulation, {
        filter: opt.value,
        query: "",
      }).length;
    }
    return counts;
  }, [studentsForPopulation]);

  const summary = useMemo(() => summariseDirectory(studentsForPopulation), [studentsForPopulation]);

  const visible = useMemo(
    () =>
      filterDirectory(students ?? [], {
        filters: selectedFilters.length > 0 ? selectedFilters : undefined,
        filter: selectedFilters.length === 0 ? "all" : undefined,
        query,
        campus,
        degree,
        branch,
        passingYear,
        srfStatuses: srfStatuses.length > 0 ? srfStatuses : undefined,
        srfStatus,
        participationStatus,
        ctc,
        category,
      }),
    [
      students,
      selectedFilters,
      query,
      campus,
      degree,
      branch,
      passingYear,
      srfStatuses,
      srfStatus,
      participationStatus,
      ctc,
      category,
    ],
  );

  // A filter change can shrink the list under the page the reader was on; the
  // roster then shows page one of the list they just asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting the page is the point
  useEffect(() => {
    setPage(0);
  }, [
    selectedFilters,
    query,
    campus,
    degree,
    branch,
    passingYear,
    srfStatuses,
    participationStatus,
    ctc,
    category,
    pageSize,
  ]);

  const safePage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  const pagedStudents = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const anyFilterActive =
    selectedFilters.length > 0 ||
    query.trim() !== "" ||
    campus !== "" ||
    degree !== "" ||
    branch !== "" ||
    passingYear !== undefined ||
    srfStatuses.length > 0 ||
    participationStatus !== undefined ||
    ctc !== undefined ||
    category !== undefined;
  ctc !== undefined || category !== undefined;

  /** Back to the whole roster, in one press — chips, dropdowns and search. */
  const clearAll = () => {
    setQuery("");
    setParams(new URLSearchParams(), { replace: true });
  };

  const pendingSet = useMemo(() => new Set(pending), [pending]);
  const pendingStudents = useMemo(
    () => (students ?? []).filter((s) => pendingSet.has(s.studentId)),
    [students, pendingSet],
  );

  async function exportCsv() {
    setExporting(true);
    setExportNote(null);
    setExportProblem(null);
    try {
      const studentIds = visible.map((s) => s.studentId);
      const links = (await view.resumeLinks?.(studentIds)) ?? new Map<string, string>();

      const rows = visible.map((s) => ({
        Student: s.fullName,
        "Roll number": s.rollNumber,
        Campus: s.campusName,
        Degree: s.degree,
        Branch: s.branch,
        "Passing year": String(s.passingYear),
        CGPA: s.cgpa === null ? "" : s.cgpa.toFixed(2),
        Registration: SRF_LABEL[s.srfStatus],
        Participation: participationStatusLabel(s.participationStatus),
        Applications: String(s.applications),
        Company: s.placement?.companyName ?? "",
        Role: s.placement?.roleTitle ?? "",
        "CTC (LPA)": s.placement === null ? "" : String(s.placement.ctcLpa),
        "Offer category":
          s.placement?.offerCategory == null ? "" : offerCategoryLabel(s.placement.offerCategory),
        Source:
          s.placement === null
            ? ""
            : s.placement.source === "self_placed"
              ? "Self-placed"
              : "On-campus",
        "Resume link": links.get(s.studentId) ?? "",
      }));

      // BOM-prefixed so Excel reads it as UTF-8 rather than mangling every name.
      download(
        `students-${selectedFilters.join("-") || "all"}.csv`,
        `\uFEFF${serialiseCsv([...EXPORT_COLUMNS], rows)}`,
      );
      /*
       * #78/#79 (UAT 2026-10-18): the file is not the same thing as the list.
       * A resume link is minted per stored file, and a student whose CV row is
       * gone or whose bucket read was refused gets an empty cell — so the count
       * says what arrived, including when none of it did.
       */
      setExportNote(`Exported ${rows.length} students. ${describeResumeLinks(rows)}`);
    } catch (cause) {
      setExportProblem(
        cause instanceof Error && cause.message !== ""
          ? cause.message
          : "The export did not run. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  if (failed) {
    return (
      <div>
        <PageHeader title="Students" />
        <ErrorPanel
          onRetry={() => {
            setFailed(false);
            setAttempt((count) => count + 1);
          }}
        >
          We could not load the students.
        </ErrorPanel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Everyone in the placement process, and what became of them."
        actions={
          students !== null &&
          students.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              isLoading={exporting}
              onClick={() => void exportCsv()}
            >
              Export {visible.length} to CSV
            </Button>
          )
        }
      />

      {exportProblem !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {exportProblem}
        </div>
      )}

      {exportNote !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          {exportNote}
        </p>
      )}

      {/* A queue that could not be read is not an empty queue. */}
      {pendingProblem !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {pendingProblem}
        </div>
      )}

      {/* Said out loud because a hold that landed silently is a hold the next
          manager believes was never placed. */}
      {holdNote !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          {holdNote}
        </p>
      )}

      {students === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading students…
        </p>
      ) : students.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No students yet. They appear here as soon as a campus roster is imported.
          </p>
        </Card>
      ) : (
        <>
          {/* 0130: a self-placed request closes nothing until this manager
              confirms it, so the waiting ones are said at the top rather than
              left for whoever happens to open the right record. */}
          {pendingStudents.length > 0 && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-ink-900"
            >
              <p className="font-semibold">
                {pendingStudents.length === 1
                  ? "1 self-placed request is waiting on you."
                  : `${pendingStudents.length} self-placed requests are waiting on you.`}
              </p>
              <p className="mt-1 text-ink-700">
                Their drives stay open until you confirm the hold.{" "}
                {pendingStudents.map((student, index) => (
                  <span key={student.studentId}>
                    {index > 0 && ", "}
                    <Link
                      to={`/students/${student.studentId}`}
                      aria-label={`Open the request from ${student.fullName}`}
                      className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                    >
                      {student.fullName}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          )}

          {/* Compact filter strip: population chips on one line, search beside them.
          Column filters live in the table headers now, not in dropdowns above. */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div
              role="radiogroup"
              aria-label="Filter students"
              className="flex flex-nowrap overflow-x-auto [scrollbar-width:none] gap-1.5"
            >
              {FILTERS.map((option) => {
                const isOptionActive =
                  option.value === "all"
                    ? !anyFilterActive
                    : selectedFilters.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                      isOptionActive
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-line bg-surface text-ink-700 hover:border-violet-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="student-filter"
                      aria-label={option.label}
                      className="sr-only"
                      checked={isOptionActive}
                      onChange={() =>
                        update({ filter: option.value === "all" ? undefined : option.value })
                      }
                    />
                    <span>{option.label}</span>
                    {filterCounts[option.value] !== undefined && (
                      <span
                        aria-hidden="true"
                        className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                          isOptionActive
                            ? "bg-white/25 text-white"
                            : "bg-surface-muted text-ink-500"
                        }`}
                      >
                        {filterCounts[option.value]}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <input
              type="search"
              aria-label="Search students"
              placeholder="Name, roll, company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ml-auto rounded-lg border border-line px-3 py-1 text-sm text-ink-900 sm:max-w-[200px]"
            />
            {anyFilterActive && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                Clear all
              </Button>
            )}
          </div>

          {/* Active filter chips: whenever the list is narrowed, show the active filters with quick clear buttons */}
          {anyFilterActive && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {selectedFilters.map((f) => {
                const label = isPlacementFilter(f)
                  ? `Placement: ${
                      f === "placed"
                        ? "Placed (All)"
                        : f === "on_campus"
                          ? "On-campus"
                          : f === "self_placed"
                            ? "Self-placed"
                            : "Not placed"
                    }`
                  : f === "submitted"
                    ? "Registration: Form submitted"
                    : f === "verified"
                      ? "Registration: Verified"
                      : `Status: ${String(f).replace("_", " ")}`;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-label={`Clear filter, ${String(f).replace("_", " ")}`}
                    onClick={() => {
                      const next = selectedFilters.filter((x) => x !== f);
                      update({ filter: next.length === 0 ? undefined : next.join(",") });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                  >
                    <span>{label}</span>
                    <span aria-hidden="true">✕</span>
                  </button>
                );
              })}
              {campus !== "" && (
                <button
                  type="button"
                  aria-label={`Clear campus filter, ${campus}`}
                  onClick={() => update({ campus: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Campus: {campus} ✕
                </button>
              )}
              {srfStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-label={`Clear registration filter, ${SRF_LABEL[status]}`}
                  onClick={() => {
                    const next = srfStatuses.filter((s) => s !== status);
                    update({ srf: next.length === 0 ? undefined : next.join(",") });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Registration: {SRF_LABEL[status]} ✕
                </button>
              ))}
              {degree !== "" && (
                <button
                  type="button"
                  aria-label={`Clear degree filter, ${degree}`}
                  onClick={() => update({ degree: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Degree: {degree} ✕
                </button>
              )}
              {branch !== "" && (
                <button
                  type="button"
                  aria-label={`Clear branch filter, ${branch}`}
                  onClick={() => update({ branch: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Branch: {branch} ✕
                </button>
              )}
              {passingYear !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear passing year filter, ${passingYear}`}
                  onClick={() => update({ year: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Batch: {passingYear} ✕
                </button>
              )}
              {participationStatus !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear standing filter, ${participationStatusLabel(participationStatus)}`}
                  onClick={() => update({ participation: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Standing: {participationStatusLabel(participationStatus)} ✕
                </button>
              )}
              {ctc !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear the package filter, ₹${ctc} LPA`}
                  onClick={() => update({ ctc: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  Package ₹{ctc} LPA ✕
                </button>
              )}
              {category !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear the category filter, ${offerCategoryLabel(category)}`}
                  onClick={() => update({ category: undefined })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 transition-colors"
                >
                  {offerCategoryLabel(category)} ✕
                </button>
              )}
            </div>
          )}

          {/* G7 (UAT 2026-08-20): the counts are controls, not prose — each
              applies the filter behind its number. They are buttons rather
              than underlined words because underlined brand text reads as a
              page to visit, not a filter to apply. */}
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <span>
              <strong className="text-ink-900">{visible.length} students</strong> of {summary.total}
            </span>
            <Button size="sm" variant="ghost" onClick={() => update({ filter: "placed" })}>
              {summary.placed} placed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update({ filter: "not_placed" })}>
              {summary.notPlaced} not placed
            </Button>
          </p>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      Campus
                      <ColumnFilterButton label="Campus" active={campus !== ""}>
                        <ColumnFilterSearch
                          label="Campus"
                          value={campus}
                          onChange={(next) => update({ campus: next })}
                          placeholder="Search campus…"
                          options={campusOptions}
                        />
                      </ColumnFilterButton>
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      Registration
                      <ColumnFilterButton
                        label="Registration"
                        active={selectedSrfForColumn.length > 0}
                      >
                        <ColumnFilterOptions
                          label="Registration status"
                          options={srfOptionsWithCounts}
                          selected={selectedSrfForColumn}
                          onChange={(next) => {
                            const nextSrf = next.filter((v) => isSrfStatus(v));
                            const remainingFilters = selectedFilters.filter(
                              (f) => !isRegistrationFilter(f),
                            );
                            update({
                              srf: nextSrf.length === 0 ? undefined : nextSrf.join(","),
                              filter:
                                remainingFilters.length === 0
                                  ? undefined
                                  : remainingFilters.join(","),
                            });
                          }}
                        />
                      </ColumnFilterButton>
                    </span>
                  </th>
                  <th className="px-4 py-3">Applications</th>
                  <th className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      Placement
                      <ColumnFilterButton
                        label="Placement"
                        active={selectedPlacementFilters.length > 0}
                      >
                        <ColumnFilterOptions
                          label="Placement outcome"
                          options={placementOptions}
                          selected={selectedPlacementFilters}
                          onChange={(next) => {
                            const nonPlacementFilters = selectedFilters.filter(
                              (f) => !isPlacementFilter(f),
                            );
                            const combined = [...nonPlacementFilters, ...next];
                            update({
                              filter: combined.length === 0 ? undefined : combined.join(","),
                            });
                          }}
                        />
                      </ColumnFilterButton>
                    </span>
                  </th>
                  {holds !== undefined && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="table-rows divide-y divide-line">
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={holds !== undefined ? 6 : 5}
                      className="py-12 text-center text-sm text-ink-700"
                    >
                      <p>No students match this search.</p>
                      {anyFilterActive && (
                        <div className="mt-3">
                          <Button variant="secondary" size="sm" onClick={clearAll}>
                            Clear all filters
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((student) => (
                    <tr
                      key={student.studentId}
                      className="hover:bg-surface-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-ink-900">
                            {/* G7: the name is the door to the canonical record. */}
                            <Link
                              to={`/students/${student.studentId}`}
                              className="hover:underline hover:text-brand-600"
                            >
                              {student.fullName}
                            </Link>
                          </p>
                          {holds === undefined && (
                            <Link
                              to={`/students/${student.studentId}`}
                              className="inline-flex items-center rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-brand-700 shadow-2xs hover:bg-brand-50 hover:border-brand-300 transition-colors shrink-0"
                            >
                              Profile →
                            </Link>
                          )}
                        </div>
                        <p className="text-xs text-ink-500">
                          Roll {student.rollNumber}
                          {/* The Actions column wears an "On hold" badge when
                            holds are switched on, so the name cell stays
                            quiet rather than saying it twice in one row. */}
                          {student.participationStatus !== "active" &&
                            !(holds !== undefined && student.participationStatus === "on_hold") && (
                              <>
                                {" · "}
                                <span className="text-warning font-medium">
                                  {participationStatusLabel(student.participationStatus)}
                                </span>
                              </>
                            )}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        <p className="font-medium text-ink-900">{student.campusName}</p>
                        <p className="text-xs text-ink-500">
                          {student.degree} {student.branch} · {student.passingYear}
                          {/* 2026-10-18 (UAT): the overview's count opens a
                            popup with a CGPA column, and this is the list it
                            links into — the same figure, same two decimals. */}
                          {student.cgpa !== null && <> · {student.cgpa.toFixed(2)} CGPA</>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={SRF_TONE[student.srfStatus]}>
                          {SRF_LABEL[student.srfStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink-700">
                        {student.applications}
                      </td>
                      <td className="px-4 py-3">
                        {student.placement === null ? (
                          // A fact, not a blank cell: an empty column reads as
                          // missing data rather than as an unplaced student.
                          <span className="text-xs font-medium text-ink-400">Not placed</span>
                        ) : (
                          <>
                            <p className="max-w-[200px] break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                              {student.placement.companyName}
                              {student.placement.source === "self_placed" && (
                                <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                                  Self-placed
                                </span>
                              )}
                            </p>
                            <p className="max-w-[200px] break-words text-xs text-ink-500 [overflow-wrap:anywhere]">
                              {student.placement.roleTitle ?? "Role not recorded"} · ₹
                              {student.placement.ctcLpa} LPA
                              {student.placement.offerCategory !== null &&
                                ` · ${offerCategoryLabel(student.placement.offerCategory)}`}
                            </p>
                          </>
                        )}
                      </td>
                      {holds !== undefined && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={`/students/${student.studentId}`}
                              className="inline-flex items-center rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-brand-700 shadow-2xs hover:bg-brand-50 hover:border-brand-300 transition-colors"
                            >
                              Profile →
                            </Link>
                            {student.participationStatus === "on_hold" ? (
                              <Badge tone="warning">On hold</Badge>
                            ) : pendingSet.has(student.studentId) ? (
                              <Badge tone="warning">Request waiting</Badge>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label={`Hold ${student.fullName}`}
                                onClick={() =>
                                  setHolding({
                                    studentId: student.studentId,
                                    fullName: student.fullName,
                                    rollNumber: student.rollNumber,
                                  })
                                }
                              >
                                Hold
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
          {visible.length > 0 && (
            <TablePager
              page={page}
              pageSize={pageSize}
              total={visible.length}
              unit="students"
              onPage={setPage}
              onPageSize={setPageSize}
            />
          )}
        </>
      )}

      {holding !== null && holds !== undefined && (
        <HoldDialog
          target={holding}
          holds={holds}
          onClose={() => setHolding(null)}
          onPlaced={(student) => {
            setHoldNote(
              `${student.fullName} is on hold. Every drive is closed to them and nothing reaches them by notification until a Campus Manager releases it from their record.`,
            );
            setHolding(null);
            // The row's own "On hold" badge is the proof the write landed, and
            // it comes from the roster — so the roster is re-read rather than
            // painted from the click that was hoped for.
            setAttempt((count) => count + 1);
          }}
        />
      )}
    </div>
  );
}
