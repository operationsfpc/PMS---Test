import { NotificationBody } from "@components/notification-body";
import { OfferLetterLink } from "@components/offer-letter-link";
import { Badge, Card, PageHeader } from "@components/ui";
import {
  filterNotifications,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
  sortNotifications,
} from "@domain/notifications";
import { useEffect, useState } from "react";
import type { StudentNotificationRow } from "./student-dashboard";

/** The dashboard's view already answers both questions; this page needs no more. */
export interface NotificationsView {
  notifications(): Promise<readonly StudentNotificationRow[]>;
  markRead(notificationId: string): Promise<void>;
}

/** Asia/Kolkata, always: a student in Chennai should not read a UTC date. */
const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Every notification the student has — E1's "Read More" destination
 * (UAT 2026-08-19).
 *
 * Unread first, then newest first, each dated. Marking one read sinks it and
 * relabels it; it is never removed. A notification is a record of what the
 * process told the student, and records do not vanish because they were seen.
 */
const FILTER_LABEL: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
  read: "Read",
};

export function NotificationsPage({ view }: { view: NotificationsView }) {
  const [notes, setNotes] = useState<readonly StudentNotificationRow[] | null>(null);
  /** G3 (UAT 2026-08-20): a lens on read state — never a deletion. */
  const [filter, setFilter] = useState<NotificationFilter>("all");

  useEffect(() => {
    void view.notifications().then(setNotes);
  }, [view]);

  async function markRead(id: string) {
    await view.markRead(id);
    setNotes(await view.notifications());
  }

  const sorted = sortNotifications(notes ?? []);
  const unread = sorted.filter((n) => !n.read).length;
  const visible = filterNotifications(sorted, filter);

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Everything the placement process has told you, newest first."
      />

      {notes === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading notifications…
        </p>
      ) : sorted.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No notifications yet. You will hear here when you are shortlisted, clear a round or
            receive an offer.
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          {unread > 0 && (
            <p className="mb-3">
              <Badge tone="warning">{unread} unread</Badge>
            </p>
          )}
          <fieldset className="mb-3">
            <legend className="sr-only">Filter notifications</legend>
            <div role="radiogroup" aria-label="Filter notifications" className="flex gap-2">
              {NOTIFICATION_FILTERS.map((option) => (
                <label
                  key={option}
                  className={`cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium ${
                    filter === option
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-line bg-surface text-ink-700 hover:border-brand-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="notification-filter"
                    className="sr-only"
                    checked={filter === option}
                    onChange={() => setFilter(option)}
                  />
                  {FILTER_LABEL[option]}
                </label>
              ))}
            </div>
          </fieldset>
          {visible.length === 0 && (
            <p className="text-sm text-ink-500">Nothing under this filter.</p>
          )}
          <ul className="space-y-2">
            {visible.map((note) => (
              <li
                key={note.id}
                className={`rounded-lg border p-3 ${
                  note.read ? "border-line" : "border-warning/50 bg-warning/5"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{note.title}</p>
                    <p className="mt-0.5 text-sm text-ink-700">
                      <NotificationBody body={note.body} />
                    </p>
                    {/* UAT 2026-08-27: the offer letter, under the message it
                        belongs to. Which message that is, is the domain's
                        call — see `notificationCarriesOfferLetter`. */}
                    <OfferLetterLink url={note.letterUrl} name={note.letterName} className="mt-1" />
                    <p className="mt-1 text-xs text-ink-500">{onDate(note.createdAt)}</p>
                  </div>
                  {note.read ? (
                    <span className="shrink-0 text-xs font-medium text-ink-500">✓ Read</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markRead(note.id)}
                      className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
