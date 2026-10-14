import { Badge, Button, Card, DataTable } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useEffect, useMemo, useState } from "react";
import type { CampusOption } from "./roster-import-page";

interface Student {
  readonly id: string;
  readonly full_name: string;
  readonly email: string;
  readonly roll_number: string | null;
  readonly campus_id: string;
  readonly passing_year: number | null;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/**
 * Shows existing students below the import form, so administrators can see who
 * has already been added without leaving the page.
 */
export function ExistingStudentsList({ campuses }: { campuses: readonly CampusOption[] }) {
  const [students, setStudents] = useState<readonly Student[] | null>(null);
  const [filterCampus, setFilterCampus] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    let active = true;
    void supabase()
      .from("students")
      .select("id, full_name, email, roll_number, campus_id, passing_year")
      .order("full_name")
      .then(({ data }) => {
        if (active) {
          setStudents((data ?? []) as Student[]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Compute available passing years
  const passingYears = useMemo(() => {
    if (students === null) return [];
    const years = new Set<number>();
    for (const s of students) {
      if (s.passing_year !== null) years.add(s.passing_year);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [students]);

  // Filter students based on search, campus, and passing year
  const filtered = useMemo(() => {
    if (students === null) return [];
    return students.filter((s) => {
      if (filterCampus !== "" && s.campus_id !== filterCampus) return false;
      if (filterYear !== "" && String(s.passing_year) !== filterYear) return false;
      if (search.trim() !== "") {
        const q = search.toLowerCase();
        const matchesName = s.full_name.toLowerCase().includes(q);
        const matchesEmail = s.email.toLowerCase().includes(q);
        const matchesRoll = s.roll_number?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesEmail && !matchesRoll) return false;
      }
      return true;
    });
  }, [students, filterCampus, filterYear, search]);

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? "Unknown";

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedStudents = filtered.slice(startIndex, startIndex + pageSize);

  return (
    <Card className="p-5">
      {/* Header and Filter Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[Raleway] text-base font-bold text-ink-900">
            Existing students ({filtered.length})
          </h2>
          <p className="text-xs text-ink-500">
            Browse and search students currently enrolled in the placement management system
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, roll no, or email…"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden min-w-[200px]"
          />

          {/* Campus Filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="campus-filter" className="text-xs font-medium text-ink-700 sr-only">
              Campus:
            </label>
            <select
              id="campus-filter"
              value={filterCampus}
              onChange={(e) => {
                setFilterCampus(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-hidden"
            >
              <option value="">All campuses</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Passing Year Filter */}
          {passingYears.length > 0 && (
            <select
              value={filterYear}
              onChange={(e) => {
                setFilterYear(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-hidden"
            >
              <option value="">All years</option>
              {passingYears.map((yr) => (
                <option key={yr} value={yr}>
                  Class of {yr}
                </option>
              ))}
            </select>
          )}

          {/* Reset Filters Button */}
          {(search !== "" || filterCampus !== "" || filterYear !== "") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setFilterCampus("");
                setFilterYear("");
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {students === null ? (
        <p role="status" className="text-sm text-neutral-500 py-6 text-center">
          Loading students…
        </p>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-ink-500">
            {filterCampus
              ? "No students at this campus yet."
              : search || filterYear
                ? "No students match your search filters."
                : "No students have been added yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-line overflow-hidden bg-surface">
            <DataTable
              caption="Existing students directory"
              columns={["Student name", "Email", "Roll number", "Campus", "Passing year", "Record"]}
            >
              {paginatedStudents.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-line hover:bg-surface-muted/30 transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium text-ink-900 text-sm">{s.full_name}</td>
                  <td className="px-3 py-2.5 text-ink-700 text-sm font-mono text-xs">{s.email}</td>
                  <td className="px-3 py-2.5 text-ink-700 text-sm font-mono text-xs">
                    {s.roll_number ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-ink-700 text-sm">{campusName(s.campus_id)}</td>
                  <td className="px-3 py-2.5 text-ink-700 text-sm">
                    {s.passing_year !== null ? <Badge tone="neutral">{s.passing_year}</Badge> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    <a
                      href={`/students/${s.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                    >
                      View profile →
                    </a>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>

          {/* Pagination Controls */}
          {filtered.length > 25 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-500">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border border-line bg-white px-2 py-1 text-xs text-ink-800"
                >
                  {PAGE_SIZE_OPTIONS.map((sz) => (
                    <option key={sz} value={sz}>
                      {sz}
                    </option>
                  ))}
                </select>
                <span>
                  Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)} of{" "}
                  {filtered.length} students
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="font-medium text-ink-700">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
