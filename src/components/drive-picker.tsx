import { compareNewestFirst, compareOldestFirst, type DriveOrder } from "@domain/drive-aging";
import { searchDrives } from "@domain/drive-portfolio";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { DriveSort } from "./drive-sort";
import { Badge, Card, type Tone } from "./ui";

/**
 * M1 (approved 2026-08-21): the one drive picker behind Shortlisting,
 * Rounds & results, Attendance and Final selection.
 *
 * Before it, Rounds & results had a bare name list and the other three
 * dead-ended at "Choose a drive…" with no list at all — reported three
 * separate times on 21/08 as "the page is empty". One component, so the four
 * pages cannot drift apart again.
 */
export interface PickerDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcLabel: string | null;
  /** When the AE raised it — the queue's age (G1a's lesson). */
  readonly raisedOn: string | null;
  readonly status: string;
}

const STATUS_TONE: Record<string, Tone> = {
  live: "brand",
  applications_closed: "warning",
  in_rounds: "warning",
  completed: "success",
};

const raisedLabel = (iso: string | null): string | null =>
  iso === null
    ? null
    : `Raised ${new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}`;

/**
 * The domain's comparators, over this component's own field name.
 *
 * 2026-08-26: the local copy sorted with `Infinity` for an undated drive and
 * was then REVERSED for newest-first, which floated every undated drive to the
 * top. `compareNewestFirst` sinks them in both directions.
 */
const compare = (order: DriveOrder) => (a: PickerDrive, b: PickerDrive) =>
  (order === "oldest" ? compareOldestFirst : compareNewestFirst)(
    { createdAt: a.raisedOn },
    { createdAt: b.raisedOn },
  );

export function DrivePicker({
  drives,
  makeLink,
  prompt,
}: {
  drives: readonly PickerDrive[];
  /** Where a chosen drive goes — the host page's own URL shape. */
  makeLink: (driveId: string) => string;
  prompt: string;
}) {
  const [query, setQuery] = useState("");
  /** Newest first, like every other drive list (2026-08-26). */
  const [sort, setSort] = useState<DriveOrder>("newest");

  const visible = useMemo(
    () => [...searchDrives(drives, query)].sort(compare(sort)),
    [drives, query, sort],
  );

  return (
    <Card className="p-6">
      <p className="text-sm text-ink-700">{prompt}</p>

      {drives.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No drives are in progress.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              aria-label="Search drives"
              placeholder="Search company or role…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
            <DriveSort value={sort} onChange={setSort} />
          </div>

          {visible.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No drives match “{query}”.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-200">
              {visible.map((drive) => (
                <li
                  key={drive.driveId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      to={makeLink(drive.driveId)}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {drive.companyName}
                    </Link>
                    {drive.roleTitle !== null && (
                      <span className="ml-2 text-sm text-ink-500">— {drive.roleTitle}</span>
                    )}
                    <p className="text-xs text-ink-500">
                      {[raisedLabel(drive.raisedOn), drive.ctcLabel]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[drive.status] ?? "neutral"}>
                    {drive.status.replaceAll("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
