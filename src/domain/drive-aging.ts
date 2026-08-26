import type { DriveStatus } from "./types";

/**
 * Drive aging (UAT 2026-08-20, G1).
 *
 * The Yet-to-publish list showed no date on any drive, so nobody could tell
 * how old a submission was or how long it had been pending approval — and the
 * published lists let drives whose application deadline had long passed sit
 * among the ones needing action.
 *
 * Pure rules: `now` is always passed in, never read from the wall clock.
 */

/** Flag a drive that has been pending for MORE than this many days (Q2: 3). */
export const PENDING_FLAG_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the drive was raised. Null when the date was never recorded. */
export function daysPending(createdAt: string | null, now: Date): number | null {
  if (createdAt === null) return null;
  const raised = new Date(createdAt);
  if (Number.isNaN(raised.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - raised.getTime()) / DAY_MS));
}

/** True once a drive has waited longer than the threshold. Undated drives are never flagged. */
export function isPendingTooLong(createdAt: string | null, now: Date): boolean {
  const days = daysPending(createdAt, now);
  return days !== null && days > PENDING_FLAG_DAYS;
}

/** "Raised on 19 Aug 2026", in Asia/Kolkata. Null when there is nothing to say. */
export function describeRaisedOn(createdAt: string | null): string | null {
  if (createdAt === null) return null;
  const raised = new Date(createdAt);
  if (Number.isNaN(raised.getTime())) return null;
  return `Raised on ${raised.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/**
 * Oldest first — the natural order for clearing a backlog. A drive with no
 * recorded date cannot claim to be the oldest, so it sinks to the end.
 */
export function compareOldestFirst(
  a: { readonly createdAt: string | null },
  b: { readonly createdAt: string | null },
): number {
  if (a.createdAt === null && b.createdAt === null) return 0;
  if (a.createdAt === null) return 1;
  if (b.createdAt === null) return -1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Newest first — the default everywhere since 2026-08-26 (Karthik).
 *
 * Deliberately NOT `compareOldestFirst` reversed. Oldest-first sinks an
 * undated drive because it cannot claim to be the oldest; reversing that makes
 * it claim to be the newest, and with newest-first the default that would put
 * every undated drive at the head of every list. Undated sinks either way.
 */
export function compareNewestFirst(
  a: { readonly createdAt: string | null },
  b: { readonly createdAt: string | null },
): number {
  if (a.createdAt === null && b.createdAt === null) return 0;
  if (a.createdAt === null) return 1;
  if (b.createdAt === null) return -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

/** The two orders every drive list offers. */
export type DriveOrder = "oldest" | "newest";

/**
 * One sort for every drive list on the system, so the queue, the picker and
 * the portfolio cannot answer "which is newest" differently.
 *
 * Returns a new array: sorting the caller's list in place would reorder a
 * memoised prop and make a render depend on how often it ran.
 */
export function orderDrives<T extends { readonly createdAt: string | null }>(
  drives: readonly T[],
  order: DriveOrder,
): readonly T[] {
  return [...drives].sort(order === "oldest" ? compareOldestFirst : compareNewestFirst);
}

export interface AgeableDrive {
  readonly status: DriveStatus;
  readonly applicationEnd: string | null;
}

/**
 * A drive is EXPIRED when its application deadline has passed and nothing has
 * moved it on. `in_rounds` is deliberately not expired — the deadline passing
 * is what started the rounds — and terminal states (completed, rejected) are
 * finished, not stale.
 */
export function isExpiredDrive(drive: AgeableDrive, now: Date): boolean {
  if (drive.applicationEnd === null) return false;
  if (drive.status === "in_rounds" || drive.status === "completed" || drive.status === "rejected") {
    return false;
  }
  const end = new Date(drive.applicationEnd);
  return !Number.isNaN(end.getTime()) && end.getTime() < now.getTime();
}

/** G1d (answer 1a): expired drives collapse into their own section; nothing is destroyed. */
export function partitionExpired<T extends AgeableDrive>(
  drives: readonly T[],
  now: Date,
): { readonly active: readonly T[]; readonly expired: readonly T[] } {
  return {
    active: drives.filter((d) => !isExpiredDrive(d, now)),
    expired: drives.filter((d) => isExpiredDrive(d, now)),
  };
}
