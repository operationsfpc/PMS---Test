import { ErrorPanel } from "@components/error-panel";
import { NotificationBody } from "@components/notification-body";
import { OfferLetterLink } from "@components/offer-letter-link";
import { Badge, Card, PageHeader } from "@components/ui";
import {
  filterNotifications,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
  sortNotifications,
} from "@domain/notifications";
import { Bell, CheckCircle2, Inbox, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

  const [loadingError, setLoadingError] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await view.notifications());
      setLoadingError(false);
    } catch {
      // Never an empty list: "nothing has told you anything" and "we could not
      // ask" mean opposite things, and only one of them is good news.
      setLoadingError(true);
      setNotes(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    // The read state is the only thing this changes, so a failure leaves the
    // row unread rather than throwing an unhandled rejection into the console.
    try {
      await view.markRead(id);
      setNotes(await view.notifications());
    } catch {
      setLoadingError(true);
    }
  }

  const sorted = sortNotifications(notes ?? []);
  const unread = sorted.filter((n) => !n.read).length;
  const readCount = sorted.length - unread;
  const visible = filterNotifications(sorted, filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Everything the placement process has told you, newest first."
      />

      {loadingError && (
        <ErrorPanel onRetry={() => void load()}>Could not load your notifications.</ErrorPanel>
      )}

      {notes === null ? (
        loadingError ? null : (
          <div className="rounded-2xl border border-line/70 bg-surface p-8 text-center shadow-xs">
            <p role="status" className="text-sm font-medium text-ink-500">
              Loading notifications…
            </p>
          </div>
        )
      ) : sorted.length === 0 ? (
        <Card className="rounded-2xl border border-line/70 p-8 text-center shadow-xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Inbox aria-hidden="true" className="size-6" />
          </div>
          <h3 className="mt-4 font-heading text-base font-bold text-ink-900">All caught up</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
            No notifications yet. You will hear here when you are shortlisted, clear a round or
            receive an offer.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Executive KPI overview pills */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                  Total Updates
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                  <Mail aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">{sorted.length}</p>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Action Required
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <Bell aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">{unread}</p>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Acknowledged
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">{readCount}</p>
            </div>
          </div>

          <Card className="rounded-2xl border border-line/70 p-5 shadow-xs sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-lg font-bold text-ink-900">Updates Log</h2>
                {unread > 0 && (
                  <Badge tone="warning" className="rounded-full">
                    {unread} unread
                  </Badge>
                )}
              </div>

              {/* Filter Tabs */}
              <fieldset>
                <legend className="sr-only">Filter notifications</legend>
                <div
                  role="radiogroup"
                  aria-label="Filter notifications"
                  className="inline-flex items-center gap-1 rounded-full border border-line/70 bg-surface-muted/60 p-1"
                >
                  {NOTIFICATION_FILTERS.map((option) => (
                    <label
                      key={option}
                      className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                        filter === option
                          ? "border border-brand-500 bg-brand-500 text-white shadow-2xs"
                          : "text-ink-700 hover:bg-surface hover:text-ink-900"
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
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-6 text-center">
                <p className="text-sm font-medium text-ink-500">Nothing under this filter.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map((note) => {
                  const isUnread = !note.read;
                  return (
                    <li
                      key={note.id}
                      className={`group relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                        isUnread
                          ? "border-brand-200/90 bg-gradient-to-br from-brand-50/70 via-white to-brand-50/30 p-5 shadow-xs hover:shadow-sm"
                          : "border-line/70 bg-surface p-5 shadow-xs hover:border-line hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          <div
                            aria-hidden="true"
                            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105 ${
                              isUnread
                                ? "bg-brand-500/10 text-brand-600 shadow-2xs"
                                : "bg-surface-muted text-ink-400"
                            }`}
                          >
                            {isUnread ? (
                              <Bell className="size-5" />
                            ) : (
                              <CheckCircle2 className="size-5" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-heading text-base font-bold leading-snug text-ink-900">
                                {note.title}
                              </p>
                              {isUnread && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
                                  <span className="size-1.5 rounded-full bg-brand-600 animate-pulse" />
                                  New
                                </span>
                              )}
                            </div>

                            <p className="mt-1 text-sm leading-relaxed text-ink-700">
                              <NotificationBody body={note.body} />
                            </p>

                            {/* UAT 2026-08-27: the offer letter, under the message it
                                belongs to. Which message that is, is the domain's
                                call — see `notificationCarriesOfferLetter`. */}
                            <OfferLetterLink
                              url={note.letterUrl}
                              name={note.letterName}
                              className="mt-2.5"
                            />

                            <p className="mt-2.5 text-xs text-ink-500">{onDate(note.createdAt)}</p>
                          </div>
                        </div>

                        <div className="shrink-0 self-start sm:self-center">
                          {note.read ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              ✓ Read
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void markRead(note.id)}
                              className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-2xs transition-all hover:border-brand-300 hover:bg-brand-50 active:scale-95"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
