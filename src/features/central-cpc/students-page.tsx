import { Badge, Card, PageHeader } from "@components/ui";
import { serialiseCsv } from "@domain/csv";
import { OFFER_CATEGORIES, type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import {
  type DirectoryFilter,
  type DirectoryStudent,
  filterDirectory,
  summariseDirectory,
} from "@domain/student-directory";
import type { SrfStatus } from "@domain/types";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

export interface StudentDirectoryView {
  students(): Promise<readonly DirectoryStudent[]>;
}

/**
 * Every student in the placement process, and what became of them.
 *
 * Asked for 2026-08-17. It is also the destination of the Placed count on the
 * placement overview: `?filter=placed` arrives here already filtered, because
 * a coordinator who has to filter again has been taken to the list rather than
 * to the breakdown they clicked.
 *
 * Read-only. Nothing here edits a student - verification lives with the campus
 * coordinator and this must not become a second way in.
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
  { value: "opted_out", label: "Opted out" },
];

const EXPORT_COLUMNS = [
  "Student",
  "Roll number",
  "Campus",
  "Degree",
  "Branch",
  "Passing year",
  "Registration",
  "Participation",
  "Applications",
  "Company",
  "Role",
  "CTC (LPA)",
  "Offer category",
  "Source",
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

const isCategory = (value: string | null): value is OfferCategory =>
  OFFER_CATEGORIES.some((c) => c === value);

/** A package figure from the URL. Nonsense is ignored, never shown as an empty list. */
function parseCtc(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const figure = Number(value);
  return Number.isFinite(figure) ? figure : undefined;
}

export function StudentDirectoryPage({
  view,
  download = browserDownload,
}: {
  view: StudentDirectoryView;
  download?: (filename: string, text: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState<readonly DirectoryStudent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  // The filter lives in the URL so the dashboard can link straight to a
  // breakdown, and so a coordinator can send someone the exact view they mean.
  const filterParam = params.get("filter");
  const filter: DirectoryFilter = isFilter(filterParam) ? filterParam : "all";

  /**
   * The three drill-downs the placement overview can arrive with. All in the
   * URL for the same reason as the filter, and all ignored when they are
   * nonsense - a mistyped parameter must not empty the screen.
   */
  const campus = params.get("campus") ?? "";
  const ctc = parseCtc(params.get("ctc"));
  const categoryParam = params.get("category");
  const category = isCategory(categoryParam) ? categoryParam : undefined;

  /** Changing one dimension must never silently drop the others. */
  const update = (next: Readonly<Record<string, string | undefined>>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  };

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
  }, [view]);

  const summary = useMemo(() => summariseDirectory(students ?? []), [students]);
  const visible = useMemo(
    () => filterDirectory(students ?? [], { filter, query, campus, ctc, category }),
    [students, filter, query, campus, ctc, category],
  );

  /** Every campus actually present in the rows, so the list cannot offer an empty one. */
  const campuses = useMemo(
    () =>
      [...new Set((students ?? []).map((s) => s.campusName))].sort((a, b) => a.localeCompare(b)),
    [students],
  );

  function exportCsv() {
    const rows = visible.map((s) => ({
      Student: s.fullName,
      "Roll number": s.rollNumber,
      Campus: s.campusName,
      Degree: s.degree,
      Branch: s.branch,
      "Passing year": String(s.passingYear),
      Registration: SRF_LABEL[s.srfStatus],
      Participation: s.participationStatus.replaceAll("_", " "),
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
    }));

    // BOM-prefixed so Excel reads it as UTF-8 rather than mangling every name.
    download(`students-${filter}.csv`, `\uFEFF${serialiseCsv([...EXPORT_COLUMNS], rows)}`);
  }

  if (failed) {
    return (
      <div>
        <PageHeader title="Students" />
        <p role="alert" className="rounded-card bg-danger-50 p-4 text-sm text-danger-700">
          We could not load the students. Refresh the page, or try again shortly.
        </p>
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
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-700 hover:border-brand-300"
            >
              Export {visible.length} to CSV
            </button>
          )
        }
      />

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
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <fieldset>
              <legend className="sr-only">Filter students</legend>
              <div role="radiogroup" aria-label="Filter students" className="flex flex-wrap gap-2">
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
                      name="student-filter"
                      className="sr-only"
                      checked={filter === option.value}
                      onChange={() =>
                        update({ filter: option.value === "all" ? undefined : option.value })
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* F4 carried through (2026-08-26): a card pressed on one campus
                lands here on that campus, and says so. */}
            {campuses.length > 1 && (
              <select
                aria-label="Campus"
                value={campus}
                onChange={(e) => update({ campus: e.target.value })}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-900"
              >
                <option value="">All campuses</option>
                {campuses.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <input
              type="search"
              aria-label="Search students"
              placeholder="Name, roll number, company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-56 flex-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-900"
            />
          </div>

          {/*
           * The package and category drill-downs. They are not permanent
           * filters, so they are not chips - they are what the reader pressed
           * on the overview, said out loud, with the way back attached. A
           * narrowing the reader cannot see reads as a list that lost people.
           */}
          {(ctc !== undefined || category !== undefined) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {ctc !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear the package filter, ₹${ctc} LPA`}
                  onClick={() => update({ ctc: undefined })}
                  className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500"
                >
                  Package ₹{ctc} LPA ✕
                </button>
              )}
              {category !== undefined && (
                <button
                  type="button"
                  aria-label={`Clear the category filter, ${offerCategoryLabel(category)}`}
                  onClick={() => update({ category: undefined })}
                  className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:border-brand-500"
                >
                  {offerCategoryLabel(category)} ✕
                </button>
              )}
            </div>
          )}

          {/* G7 (UAT 2026-08-20): the counts are controls, not prose — each
              applies the filter behind its number. */}
          <p className="mb-3 text-sm text-ink-500">
            Showing <strong className="text-ink-900">{visible.length} students</strong> of{" "}
            {summary.total} ·{" "}
            <button
              type="button"
              onClick={() => update({ filter: "placed" })}
              className="font-medium text-brand-600 hover:underline"
            >
              {summary.placed} placed
            </button>{" "}
            ·{" "}
            <button
              type="button"
              onClick={() => update({ filter: "not_placed" })}
              className="font-medium text-brand-600 hover:underline"
            >
              {summary.notPlaced} not placed
            </button>
          </p>

          {visible.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-ink-700">No students match this search.</p>
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Campus</th>
                    <th className="px-4 py-3">Registration</th>
                    <th className="px-4 py-3">Applications</th>
                    <th className="px-4 py-3">Placement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visible.map((student) => (
                    <tr key={student.studentId}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink-900">
                          {/* G7: the name is the door to the canonical record. */}
                          <Link to={`/students/${student.studentId}`} className="hover:underline">
                            {student.fullName}
                          </Link>
                        </p>
                        <p className="text-xs text-ink-500">
                          {student.rollNumber}
                          {student.participationStatus !== "active" && (
                            <>
                              {" · "}
                              <span className="text-warning">
                                {student.participationStatus.replaceAll("_", " ")}
                              </span>
                            </>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        <p>{student.campusName}</p>
                        <p className="text-xs text-ink-500">
                          {student.degree} {student.branch} · {student.passingYear}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={SRF_TONE[student.srfStatus]}>
                          {SRF_LABEL[student.srfStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-ink-700">{student.applications}</td>
                      <td className="px-4 py-3">
                        {student.placement === null ? (
                          // A fact, not a blank cell: an empty column reads as
                          // missing data rather than as an unplaced student.
                          <span className="text-ink-500">Not placed</span>
                        ) : (
                          <>
                            <p className="font-medium text-ink-900">
                              {student.placement.companyName}
                              {student.placement.source === "self_placed" && (
                                <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                                  Self-placed
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-ink-500">
                              {student.placement.roleTitle ?? "Role not recorded"} · ₹
                              {student.placement.ctcLpa} LPA
                              {student.placement.offerCategory !== null &&
                                ` · ${offerCategoryLabel(student.placement.offerCategory)}`}
                            </p>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
