import { groupDrivesByEvent } from "@domain/company-drive";
import { compareNewestFirst, compareOldestFirst, type DriveOrder } from "@domain/drive-aging";
import { searchDrives } from "@domain/drive-portfolio";
import { driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import type { DriveType } from "@domain/types";
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
  /** The company visit this role belongs to; null for a legacy standalone drive. */
  readonly companyDriveId?: string | null;
  readonly driveType?: DriveType | null;
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

  /**
   * One entry per company visit, in the order its newest role was raised —
   * `visible` is already sorted, and grouping preserves insertion order.
   */
  const events = useMemo(() => [...groupDrivesByEvent(visible).entries()], [visible]);

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
              {events.map(([eventId, roles]) => {
                const [only] = roles;
                return (
                  <li key={eventId} className="py-3">
                    {roles.length === 1 && only !== undefined ? (
                      <RoleRow drive={only} makeLink={makeLink} />
                    ) : (
                      <Visit visit={roles} makeLink={makeLink} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

/** The status word and its colour, spelled the way every other drive list spells it. */
const statusBadge = (status: string) => (
  <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replaceAll("_", " ")}</Badge>
);

/**
 * One role of a visit, seen from outside: the company, the job, the money,
 * when it was raised and where it stands.
 */
function RoleRow({
  drive,
  makeLink,
}: {
  drive: PickerDrive;
  makeLink: (driveId: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <Link to={makeLink(drive.driveId)} className="font-medium text-brand-600 hover:underline">
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
      {statusBadge(drive.status)}
    </div>
  );
}

/**
 * A company visit that raised more than one role, shown as the one card it is
 * (UAT 2026-10-16: "same company shows as two"). The visit is the headline and
 * each role opens beneath it with its own CTC, age and status — those facts
 * differ per role, so they are never said for the visit.
 */
function Visit({
  visit,
  makeLink,
}: {
  visit: readonly PickerDrive[];
  makeLink: (driveId: string) => string;
}) {
  // A visit that mixes an internship with a full-time role cannot pick one
  // label at random, so it says "Mixed types" and each role carries its own.
  const types = new Set(visit.map((role) => role.driveType ?? null));
  const [singleType] = types;
  const mixed = types.size > 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-ink-900">
          {visit[0]?.companyName}
          <Badge tone={mixed ? "neutral" : driveTypeTone(singleType ?? null)}>
            {mixed ? "Mixed types" : driveTypeLabel(singleType ?? null)}
          </Badge>
          <Badge tone="brand">{visit.length} roles</Badge>
        </p>
      </div>

      {/* A picker's roles are choices, not reading matter. Folded into panels
          they needed two clicks each — one to open, one to choose — and a panel
          left open by default is a table that pays the height for nothing. So:
          one row per role, each with its own link. */}
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ink-500">
            <th scope="col" className="py-1 pr-3 font-medium">
              Role
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Details
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Choose a role</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visit.map((role) => (
            <tr key={role.driveId} className="border-t border-line align-top">
              <td className="py-2 pr-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink-900">
                    {role.roleTitle ?? "Role not set"}
                  </span>
                  {mixed && (
                    <Badge tone={driveTypeTone(role.driveType ?? null)}>
                      {driveTypeLabel(role.driveType ?? null)}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="py-2 pr-3 text-xs text-ink-600">
                {[raisedLabel(role.raisedOn), role.ctcLabel]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </td>
              <td className="py-2 pr-3">{statusBadge(role.status)}</td>
              <td className="py-2 text-right">
                <Link
                  to={makeLink(role.driveId)}
                  aria-label={`Choose ${role.roleTitle ?? "this role"}`}
                  className="text-xs font-semibold text-brand-700 underline underline-offset-2"
                >
                  Choose
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
