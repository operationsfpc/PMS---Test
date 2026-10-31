import { Button } from "./ui";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface TablePagerProps {
  /** 0-based page index. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: ((pageSize: number) => void) | undefined;
  /** What the rows are, said in the range line. */
  unit?: string;
  className?: string | undefined;
}

/**
 * The pager the raw tables share, worded like the data table's so a reader
 * meets one vocabulary for paging across the app.
 */
export function TablePager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  unit = "records",
  className = "",
}: TablePagerProps) {
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const from = current * pageSize + 1;
  const to = Math.min((current + 1) * pageSize, total);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-ink-600 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span>
          Showing {from} to {to} of {total} {unit}
        </span>
        {onPageSize !== undefined && (
          <div className="ml-2 flex items-center gap-1">
            <span className="text-ink-500">Rows:</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-800"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={current === 0}
          onClick={() => onPage(current - 1)}
        >
          Previous
        </Button>
        <span className="px-2 font-medium">
          Page {current + 1} of {pageCount}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={current >= pageCount - 1}
          onClick={() => onPage(current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
