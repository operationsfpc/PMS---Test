import { Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "./ui";

export interface ColumnDef<T> {
  id: string;
  header: ReactNode;
  accessorKey?: keyof T | undefined;
  accessorFn?: ((row: T) => unknown) | undefined;
  cell?: ((row: T, index: number) => ReactNode) | undefined;
  sortable?: boolean | undefined;
  className?: string | undefined;
}

export interface ShadcnDataTableProps<T> {
  data: readonly T[];
  columns: readonly ColumnDef<T>[];
  searchPlaceholder?: string | undefined;
  searchFilterKey?: keyof T | undefined;
  searchFilterFn?: ((row: T, query: string) => boolean) | undefined;
  enableSelection?: boolean | undefined;
  onSelectionChange?: ((selected: readonly T[]) => void) | undefined;
  bulkActions?: ((selected: readonly T[], clearSelection: () => void) => ReactNode) | undefined;
  defaultPageSize?: number | undefined;
  emptyMessage?: string | undefined;
  caption?: string | undefined;
  /**
   * For a table that fills a fixed-height frame (the "See who" drawer): the
   * search box and pager stay put and only the rows scroll. The pager used to
   * be `sticky bottom-0`, which parked it over the roster mid-scroll with the
   * last row painted in the strip beneath it (2026-10-31).
   */
  fit?: boolean | undefined;
  className?: string | undefined;
}

export function ShadcnDataTable<T extends { id?: string | number }>({
  data,
  columns,
  searchPlaceholder = "Search records…",
  searchFilterKey,
  searchFilterFn,
  enableSelection = false,
  onSelectionChange,
  bulkActions,
  defaultPageSize = 10,
  emptyMessage = "No records found.",
  caption = "Data table",
  fit = false,
  className = "",
}: ShadcnDataTableProps<T>) {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  // Filtered rows
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase().trim();

    if (searchFilterFn) {
      return data.filter((row) => searchFilterFn(row, query));
    }

    if (searchFilterKey) {
      return data.filter((row) => {
        const val = row[searchFilterKey];
        return String(val ?? "")
          .toLowerCase()
          .includes(query);
      });
    }

    // Default: search all string/number fields
    return data.filter((row) =>
      Object.values(row as Record<string, unknown>).some((val) =>
        String(val ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [data, searchQuery, searchFilterKey, searchFilterFn]);

  // Sorted rows
  const sortedData = useMemo(() => {
    if (!sortColumnId) return filteredData;
    const col = columns.find((c) => c.id === sortColumnId);
    if (!col) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA: unknown;
      let valB: unknown;

      if (col.accessorFn) {
        valA = col.accessorFn(a);
        valB = col.accessorFn(b);
      } else if (col.accessorKey) {
        valA = a[col.accessorKey];
        valB = b[col.accessorKey];
      }

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const factor = sortDirection === "asc" ? 1 : -1;
      if (typeof valA === "number" && typeof valB === "number") {
        return (valA - valB) * factor;
      }
      return String(valA).localeCompare(String(valB)) * factor;
    });
  }, [filteredData, sortColumnId, sortDirection, columns]);

  // Paginated rows
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = pageIndex * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, pageIndex, pageSize]);

  /**
   * The rows can shrink under the reader without any paging click: the
   * "See who" popup switches to a smaller group tab, or a search narrows the
   * list. Page 3 of a list now one page long printed "Page 3 of 1" over an
   * empty table.
   */
  useEffect(() => {
    setPageIndex((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  /**
   * In a fixed frame the rows are the only thing that scrolls, so a page turn
   * would otherwise leave the reader halfway down an unseen list. Every new
   * page starts at its first row.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new page, search or order starts the roster at its first row
  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
  }, [pageIndex, pageSize, searchQuery, sortColumnId, sortDirection]);

  // Sorting handler
  const handleSort = (colId: string) => {
    if (sortColumnId === colId) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumnId(null);
      }
    } else {
      setSortColumnId(colId);
      setSortDirection("asc");
    }
    setPageIndex(0);
  };

  // Selection handlers
  const handleToggleRow = (row: T) => {
    const rowId = row.id ?? JSON.stringify(row);
    const next = new Set(selectedIds);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    setSelectedIds(next);
    if (onSelectionChange) {
      const selectedRows = data.filter((r) => next.has(r.id ?? JSON.stringify(r)));
      onSelectionChange(selectedRows);
    }
  };

  const handleToggleAllVisible = () => {
    const allSelected = paginatedData.every((r) => selectedIds.has(r.id ?? JSON.stringify(r)));
    const next = new Set(selectedIds);

    for (const r of paginatedData) {
      const rowId = r.id ?? JSON.stringify(r);
      if (allSelected) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
    }

    setSelectedIds(next);
    if (onSelectionChange) {
      const selectedRows = data.filter((r) => next.has(r.id ?? JSON.stringify(r)));
      onSelectionChange(selectedRows);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    onSelectionChange?.([]);
  };

  const selectedRowsList = useMemo(
    () => data.filter((r) => selectedIds.has(r.id ?? JSON.stringify(r))),
    [data, selectedIds],
  );

  const areAllVisibleSelected =
    paginatedData.length > 0 &&
    paginatedData.every((r) => selectedIds.has(r.id ?? JSON.stringify(r)));

  return (
    <div className={`flex flex-col gap-3 ${fit ? "min-h-0 flex-1" : ""} ${className}`}>
      {/* Top Toolbar: Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search Box */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPageIndex(0);
            }}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-line/80 bg-surface py-2 pl-9 pr-8 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/15 shadow-xs transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchQuery("");
                setPageIndex(0);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Bulk Action Bar (when rows selected) */}
      {enableSelection && selectedRowsList.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-xs shadow-xs animate-fade-in">
          <div className="flex items-center gap-2 font-medium text-brand-900">
            <Badge tone="brand">{selectedRowsList.length} selected</Badge>
            <span>of {data.length} total records</span>
          </div>
          <div className="flex items-center gap-2">
            {bulkActions?.(selectedRowsList, clearSelection)}
            <Button size="sm" variant="secondary" onClick={clearSelection}>
              Clear selection
            </Button>
          </div>
        </div>
      )}

      {/*
       * In a fixed frame the table card is the scroll box, so the search above
       * it and the pager below it cannot move. `tabIndex` gives a keyboard
       * reader a way to scroll rows whose links are all they can otherwise
       * reach; the name is the table's own caption.
       */}
      <div
        ref={scrollRef}
        {...(fit ? { role: "region" as const, "aria-label": caption, tabIndex: 0 } : {})}
        className={
          fit
            ? "min-h-0 flex-1 overflow-auto rounded-2xl border border-line/70 bg-surface shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
            : "overflow-x-auto rounded-2xl border border-line/70 bg-surface shadow-xs"
        }
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className={fit ? "sticky top-0 z-10 bg-surface-muted/95 backdrop-blur-xs" : undefined}>
            <tr
              className={`border-b border-line/70 text-ink-500 ${
                fit ? "bg-surface-muted/95" : "bg-surface-muted/60"
              }`}
            >
              {enableSelection && (
                <th scope="col" className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={areAllVisibleSelected}
                    onChange={handleToggleAllVisible}
                    className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    sortColumnId !== col.id
                      ? "none"
                      : sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                  }
                  className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-500 ${col.className ?? ""}`}
                >
                  {/*
                   * A click handler on the header cell itself was mouse-only: a
                   * keyboard reader could reach the table but never order it, and
                   * `aria-sort` on the cell says nothing about which control does
                   * the ordering. The header is the button now.
                   *
                   * `uppercase text-left` is repeated from the `<th>` because a
                   * button is not a span: `text-transform` is a property that does
                   * not inherit and the browser's own button style centres its
                   * text, so without them every sortable column rendered as
                   * "Student" beside a static column's "PROGRAMME".
                   */}
                  {col.sortable === true ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.id)}
                      title={`Sort by ${typeof col.header === "string" ? col.header : col.id}`}
                      className="flex items-center gap-1.5 rounded text-left uppercase text-inherit transition-colors hover:text-ink-900"
                    >
                      <span className="font-semibold">{col.header}</span>
                      <span
                        aria-hidden="true"
                        className={`text-[10px] ${sortColumnId === col.id ? "font-bold text-brand-600" : "text-ink-400"}`}
                      >
                        {sortColumnId === col.id ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                  ) : (
                    <span className="font-semibold">{col.header}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {paginatedData.length > 0 ? (
              paginatedData.map((row, idx) => {
                const rowId = row.id ?? JSON.stringify(row);
                const isSelected = selectedIds.has(rowId);

                return (
                  <tr
                    key={rowId}
                    className={`transition-colors hover:bg-surface-muted/60 ${
                      isSelected ? "bg-brand-50/50" : ""
                    }`}
                  >
                    {enableSelection && (
                      <td className="w-10 px-4 text-center py-3.5">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${idx + 1}`}
                          checked={isSelected}
                          onChange={() => handleToggleRow(row)}
                          className="size-4 rounded border-line text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      let cellContent: ReactNode;
                      if (col.cell) {
                        cellContent = col.cell(row, idx);
                      } else if (col.accessorFn) {
                        cellContent = String(col.accessorFn(row) ?? "—");
                      } else if (col.accessorKey) {
                        cellContent = String(row[col.accessorKey] ?? "—");
                      } else {
                        cellContent = "—";
                      }

                      return (
                        <td
                          key={col.id}
                          className={`px-4 text-sm text-ink-900 py-3.5 ${col.className ?? ""}`}
                        >
                          {cellContent}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={columns.length + (enableSelection ? 1 : 0)}
                  className="py-12 text-center text-xs text-ink-500"
                >
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <p className="font-semibold text-ink-700">{emptyMessage}</p>
                    {searchQuery && (
                      <Button size="sm" variant="ghost" onClick={() => setSearchQuery("")}>
                        Reset search filter
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/*
       * Pagination Footer — visible whenever records are shown, even when
       * they all fit one page. UAT 2026-10-23: hiding the footer for a single
       * page read as "the table is broken" (21 rows, no pagination anywhere),
       * and a hidden "Rows" control meant a long list could never be paged.
       * At the page edges the Previous/Next buttons sit disabled, as elsewhere.
       *
       * In a fixed frame it is a flex sibling of the scroll box, not a sticky
       * overlay: the band owns the drawer's bottom padding (`-mb-6 pb-6`) and
       * no row can ever paint below or beneath it.
       */}
      {sortedData.length > 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 text-xs text-ink-600 ${
            fit ? "shrink-0 -mx-6 -mb-6 border-t border-line bg-surface px-6 pb-6 pt-3" : "pt-1"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>
              Showing {Math.min(pageIndex * pageSize + 1, sortedData.length)} to{" "}
              {Math.min((pageIndex + 1) * pageSize, sortedData.length)} of {sortedData.length}{" "}
              records
            </span>
            <div className="flex items-center gap-1 ml-2">
              <span className="text-ink-500">Rows:</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPageIndex(0);
                }}
                className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-800"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="px-2 font-medium">
              Page {pageIndex + 1} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={pageIndex >= totalPages - 1}
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
