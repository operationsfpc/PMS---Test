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
  className = "",
}: ShadcnDataTableProps<T>) {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [hiddenColumnIds, setHiddenColumnIds] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  /**
   * The picker used to stay open over the rows once clicked, with nothing to
   * shut it — so the first press a reader made afterwards landed on a column
   * checkbox rather than the row they aimed at. It also never told a screen
   * reader whether the list of columns was up.
   */
  useEffect(() => {
    if (!isColumnPickerOpen) return;

    function onPointerDown(event: PointerEvent) {
      const picker = columnPickerRef.current;
      if (picker !== null && !picker.contains(event.target as Node)) {
        setIsColumnPickerOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsColumnPickerOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isColumnPickerOpen]);

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

  // Visible columns
  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumnIds.has(col.id)),
    [columns, hiddenColumnIds],
  );

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
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Top Toolbar: Search, Filters, Column Toggle, Density */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search Box */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPageIndex(0);
            }}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 placeholder:italic placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
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

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Density Toggle */}
          <button
            type="button"
            aria-label="Toggle row density"
            aria-pressed={density === "compact"}
            title={density === "comfortable" ? "Compact the rows" : "Give the rows more room again"}
            onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted transition-colors aria-pressed:border-brand-300 aria-pressed:bg-brand-50 aria-pressed:text-brand-700"
          >
            {density === "comfortable" ? "Compact" : "Comfortable"}
          </button>

          {/* Column Visibility Picker */}
          <div className="relative" ref={columnPickerRef}>
            <button
              type="button"
              onClick={() => setIsColumnPickerOpen((o) => !o)}
              aria-expanded={isColumnPickerOpen}
              aria-haspopup="true"
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted transition-colors flex items-center gap-1.5"
            >
              <span>Columns</span>
              <span
                aria-hidden="true"
                className={`transition-transform ${isColumnPickerOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>

            {isColumnPickerOpen && (
              <div className="absolute right-0 z-30 mt-1 w-48 rounded-xl border border-line bg-surface p-2 shadow-xl animate-fade-in">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1 px-1">
                  Toggle Columns
                </p>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {columns.map((col) => {
                    const isVisible = !hiddenColumnIds.has(col.id);
                    return (
                      <label
                        key={col.id}
                        className="flex items-center gap-2 px-1.5 py-1 rounded text-xs text-ink-700 hover:bg-surface-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={(e) => {
                            const next = new Set(hiddenColumnIds);
                            if (e.target.checked) {
                              next.delete(col.id);
                            } else {
                              next.add(col.id);
                            }
                            setHiddenColumnIds(next);
                          }}
                          className="rounded border-line text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                        />
                        <span className="truncate">
                          {typeof col.header === "string" ? col.header : col.id}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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

      {/* Table Card Container */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-xs">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-muted/50 text-ink-700">
              {enableSelection && (
                <th scope="col" className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={areAllVisibleSelected}
                    onChange={handleToggleAllVisible}
                    className="rounded border-line text-brand-600 focus:ring-brand-500 h-4 w-4"
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
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
                  className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-ink-600 ${col.className ?? ""}`}
                >
                  {/*
                   * A click handler on the header cell itself was mouse-only: a
                   * keyboard reader could reach the table but never order it, and
                   * `aria-sort` on the cell says nothing about which control does
                   * the ordering. The header is the button now.
                   */}
                  {col.sortable === true ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.id)}
                      title={`Sort by ${typeof col.header === "string" ? col.header : col.id}`}
                      className="flex items-center gap-1.5 rounded text-inherit hover:text-ink-900"
                    >
                      <span>{col.header}</span>
                      <span aria-hidden="true" className="text-[10px] text-ink-400">
                        {sortColumnId === col.id ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {paginatedData.length > 0 ? (
              paginatedData.map((row, idx) => {
                const rowId = row.id ?? JSON.stringify(row);
                const isSelected = selectedIds.has(rowId);
                const paddingY = density === "comfortable" ? "py-3" : "py-1.5";

                return (
                  <tr
                    key={rowId}
                    className={`transition-colors hover:bg-surface-muted/50 ${
                      isSelected ? "bg-brand-50/40" : ""
                    }`}
                  >
                    {enableSelection && (
                      <td className={`w-10 px-3 text-center ${paddingY}`}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${idx + 1}`}
                          checked={isSelected}
                          onChange={() => handleToggleRow(row)}
                          className="rounded border-line text-brand-600 focus:ring-brand-500 h-4 w-4"
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => {
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
                          className={`px-3 text-sm text-ink-900 ${paddingY} ${col.className ?? ""}`}
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
                  colSpan={visibleColumns.length + (enableSelection ? 1 : 0)}
                  className="py-12 text-center text-xs text-ink-500"
                >
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <p className="font-semibold text-ink-700">{emptyMessage}</p>
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="text-brand-600 underline text-[11px]"
                      >
                        Reset search filter
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {sortedData.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-600 pt-1">
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
