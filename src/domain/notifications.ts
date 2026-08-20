/**
 * How a student's notifications are ordered and condensed.
 *
 * E1/E2/E4 (UAT 2026-08-19). The rules:
 *   - unread before read — marking a note read SINKS it, never deletes it;
 *   - newest first within each group;
 *   - the dashboard shows a few and says how many more there are.
 *
 * The testers reported new notifications "replacing" old ones. The rows stack
 * correctly in the database (proved live 2026-08-19); what they saw was a
 * panel with no order and no boundary, where every arrival visually displaced
 * the rest. An explicit order and a stated "N more" are the remedy.
 */

export interface NotificationItem {
  readonly id: string;
  /** ISO timestamp. String comparison is safe within a single format. */
  readonly createdAt: string;
  readonly read: boolean;
}

/** Unread first, then newest first. Pure — never mutates the input. */
export function sortNotifications<T extends NotificationItem>(notes: readonly T[]): readonly T[] {
  return [...notes].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export interface CondensedNotifications<T> {
  readonly shown: readonly T[];
  /** How many exist beyond the shown — the "Read all" link's number. */
  readonly hidden: number;
}

/** The dashboard's view: the top `limit` after sorting, and how many more. */
export function condenseNotifications<T extends NotificationItem>(
  notes: readonly T[],
  limit: number,
): CondensedNotifications<T> {
  const sorted = sortNotifications(notes);
  return {
    shown: sorted.slice(0, limit),
    hidden: Math.max(0, sorted.length - limit),
  };
}

/** G3 (UAT 2026-08-20): the full log's read-state lens. */
export type NotificationFilter = "all" | "unread" | "read";

export const NOTIFICATION_FILTERS: readonly NotificationFilter[] = ["all", "unread", "read"];

/** A lens, not an edit: filtering never reorders and never deletes. */
export function filterNotifications<T extends NotificationItem>(
  notes: readonly T[],
  filter: NotificationFilter,
): readonly T[] {
  if (filter === "unread") return notes.filter((n) => !n.read);
  if (filter === "read") return notes.filter((n) => n.read);
  return notes;
}
