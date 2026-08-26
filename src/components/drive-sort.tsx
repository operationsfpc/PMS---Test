import type { DriveOrder } from "@domain/drive-aging";

/**
 * The sort control every drive list shares.
 *
 * G1b (UAT 2026-08-20) gave the publish queue an oldest-first order so a
 * backlog could be cleared from the back, and the drive picker copied it.
 * 2026-08-26 (Karthik): the same control belongs on Live drives, and NEWEST
 * first is the default everywhere — a coordinator opening a list is looking
 * for what just happened, not for the bottom of the backlog.
 *
 * One component, so a third copy cannot quietly keep the old default.
 */
export function DriveSort({
  value,
  onChange,
}: {
  value: DriveOrder;
  onChange: (order: DriveOrder) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-700">
      Sort
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DriveOrder)}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-900"
      >
        {/* Newest first is the default, so it reads first. */}
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </label>
  );
}
