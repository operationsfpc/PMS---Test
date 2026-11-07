import { ErrorPanel } from "@components/error-panel";
import { NotificationBody } from "@components/notification-body";
import { OfferLetterLink } from "@components/offer-letter-link";
import { Badge, ButtonLink, Card, LottieLoader, PageHeader } from "@components/ui";
import {
  extractNotificationMetadata,
  filterNotifications,
  formatRelativeTime,
  getNotificationCategory,
  isDocumentLink,
  NOTIFICATION_FILTERS,
  type NotificationCategory,
  type NotificationFilter,
  sortNotifications,
} from "@domain/notifications";
import {
  ArrowRight,
  Award,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  FileDown,
  FileEdit,
  FileText,
  Inbox,
  Layers,
  MapPin,
  Search,
  ShieldAlert,
  Tag,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudentNotificationRow } from "./student-dashboard";

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

const FILTER_LABEL: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
  read: "Read",
};

interface CategoryStyle {
  readonly label: string;
  readonly icon: typeof Briefcase;
  readonly bgLight: string;
  readonly borderLight: string;
  readonly textColor: string;
}

const CATEGORY_CONFIG: Record<NotificationCategory | "all", CategoryStyle> = {
  all: {
    label: "All Updates",
    icon: Layers,
    bgLight: "bg-surface-muted",
    borderLight: "border-line",
    textColor: "text-ink-700",
  },
  drive: {
    label: "Drives",
    icon: Briefcase,
    bgLight: "bg-brand-50",
    borderLight: "border-brand-200",
    textColor: "text-brand-700",
  },
  interview: {
    label: "Interviews",
    icon: Calendar,
    bgLight: "bg-sky-50",
    borderLight: "border-sky-200",
    textColor: "text-sky-700",
  },
  offer: {
    label: "Offers",
    icon: Award,
    bgLight: "bg-emerald-50",
    borderLight: "border-emerald-200",
    textColor: "text-emerald-700",
  },
  profile: {
    label: "Profile & Alerts",
    icon: ShieldAlert,
    bgLight: "bg-amber-50",
    borderLight: "border-amber-200",
    textColor: "text-amber-700",
  },
  general: {
    label: "General",
    icon: Bell,
    bgLight: "bg-slate-50",
    borderLight: "border-slate-200",
    textColor: "text-slate-700",
  },
};

type PrimaryAction =
  | {
      readonly label: string;
      readonly href: string;
      readonly icon: typeof Briefcase;
      readonly isExternal: true;
    }
  | {
      readonly label: string;
      readonly to: string;
      readonly icon: typeof Briefcase;
      readonly isExternal: false;
    };

function resolvePrimaryAction(note: StudentNotificationRow): PrimaryAction | null {
  const meta = extractNotificationMetadata(note.body);
  const cat = getNotificationCategory(note.kind);

  if (cat === "drive") {
    return {
      label: "View Drive & Apply",
      to: note.driveId ? `/student/drives?driveId=${note.driveId}` : "/student/drives",
      icon: ExternalLink,
      isExternal: false,
    };
  }

  if (meta.meetingLink) {
    return isDocumentLink(meta.meetingLink)
      ? {
          label: "Open document",
          href: meta.meetingLink,
          icon: FileText,
          isExternal: true,
        }
      : {
          label: "Join Video Interview",
          href: meta.meetingLink,
          icon: Video,
          isExternal: true,
        };
  }

  if (
    note.kind === "round_scheduled" ||
    note.kind === "interview_day_reminder" ||
    note.kind === "round_cleared" ||
    note.kind === "shortlisted"
  ) {
    return {
      label: "View Application Progress",
      to: "/student",
      icon: ArrowRight,
      isExternal: false,
    };
  }

  if (cat === "offer") {
    return {
      label: "View in Offers",
      to: "/student",
      icon: Award,
      isExternal: false,
    };
  }

  if (note.kind === "srf_rejected" || note.kind === "welcome") {
    return {
      label: "Open Registration Form",
      to: "/student/profile",
      icon: FileEdit,
      isExternal: false,
    };
  }

  return null;
}

export function NotificationsPage({ view }: { view: NotificationsView }) {
  const [notes, setNotes] = useState<readonly StudentNotificationRow[] | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeReadingNote, setActiveReadingNote] = useState<StudentNotificationRow | null>(null);
  const [loadingError, setLoadingError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await view.notifications());
      setLoadingError(false);
    } catch {
      setLoadingError(true);
      setNotes(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    try {
      await view.markRead(id);
      const updated = await view.notifications();
      setNotes(updated);
      if (activeReadingNote?.id === id) {
        const found = updated.find((n) => n.id === id);
        if (found) setActiveReadingNote(found);
      }
    } catch {
      setLoadingError(true);
    }
  }

  async function markAllAsRead() {
    if (!notes) return;
    const unreadNotes = notes.filter((n) => !n.read);
    if (unreadNotes.length === 0) return;

    setMarkingAll(true);
    try {
      await Promise.all(unreadNotes.map((n) => view.markRead(n.id)));
      setNotes(await view.notifications());
    } catch {
      setLoadingError(true);
    } finally {
      setMarkingAll(false);
    }
  }

  const sorted = useMemo(() => sortNotifications(notes ?? []), [notes]);
  const unreadCount = sorted.filter((n) => !n.read).length;
  const acknowledgedCount = sorted.length - unreadCount;

  // 1. Lens on read state (always preserves tests)
  const byRead = useMemo(() => filterNotifications(sorted, filter), [sorted, filter]);

  // 2. Lens on category
  const byCategory = useMemo(() => {
    if (categoryFilter === "all") return byRead;
    return byRead.filter((n) => getNotificationCategory(n.kind) === categoryFilter);
  }, [byRead, categoryFilter]);

  // 3. Search query filter
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byCategory;
    return byCategory.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [byCategory, searchQuery]);

  if (notes === null && !loadingError) {
    return <LottieLoader size="fullscreen" message="Loading notifications…" />;
  }

  const readingCategory = activeReadingNote
    ? getNotificationCategory(activeReadingNote.kind)
    : "general";
  const readingConfig = CATEGORY_CONFIG[readingCategory] ?? CATEGORY_CONFIG.general;
  const ReadingIcon = readingConfig.icon;
  const readingMeta = activeReadingNote ? extractNotificationMetadata(activeReadingNote.body) : {};
  const readingAction = activeReadingNote ? resolvePrimaryAction(activeReadingNote) : null;
  const hasReadingMetadata = Boolean(
    readingMeta.company ||
      readingMeta.role ||
      readingMeta.ctc ||
      readingMeta.deadline ||
      readingMeta.venue ||
      readingMeta.meetingLink ||
      readingMeta.mode,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Real-time placement alerts, interview schedules, and offer announcements."
      />

      {loadingError && (
        <ErrorPanel onRetry={() => void load()}>Could not load your notifications.</ErrorPanel>
      )}

      {sorted.length === 0 ? (
        <Card className="rounded-2xl border border-line/70 p-8 text-center shadow-xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Inbox aria-hidden="true" className="size-6" />
          </div>
          <h3 className="mt-4 font-heading text-base font-bold text-ink-900">All caught up</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
            No notifications yet. Shortlists, round schedules and offers will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Executive Overview Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                  Total
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <Layers aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">{sorted.length}</p>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Unread
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <Bell aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">{unreadCount}</p>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Read
                </span>
                <div className="flex size-7 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                </div>
              </div>
              <p className="mt-2 font-heading text-2xl font-bold text-ink-900">
                {acknowledgedCount}
              </p>
            </div>
          </div>

          {/* Controls Bar: Category Filters, Search, Read Lens, Mark All */}
          <Card className="rounded-2xl border border-line/70 p-4 shadow-xs sm:p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Search Bar */}
                <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search updates…"
                    className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-8 text-xs font-medium text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Mark All Read Button */}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markAllAsRead()}
                      disabled={markingAll}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-3.5 py-2 text-xs font-semibold text-brand-700 shadow-2xs hover:bg-brand-50 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <CheckCheck className="size-3.5" />
                      Mark all read
                    </button>
                  )}

                  {/* Read State Radio Group (Strictly preserves existing test selectors) */}
                  <fieldset>
                    <legend className="sr-only">Filter notifications</legend>
                    <div
                      role="radiogroup"
                      aria-label="Filter notifications"
                      className="inline-flex items-center gap-1 rounded-xl border border-line/70 bg-surface-muted/60 p-1"
                    >
                      {NOTIFICATION_FILTERS.map((option) => (
                        <label
                          key={option}
                          className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                            filter === option
                              ? "border border-brand-500 bg-brand-600 text-white shadow-2xs"
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
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3">
                <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                  Categories:
                </span>
                {(["all", "drive", "interview", "offer", "profile"] as const).map((cat) => {
                  const cfg = CATEGORY_CONFIG[cat];
                  const Icon = cfg.icon;
                  const isSelected = categoryFilter === cat;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                        isSelected
                          ? "border-brand-500 bg-brand-50 font-bold text-brand-700 shadow-2xs"
                          : "border-line bg-surface text-ink-600 hover:border-line-dark hover:bg-surface-muted/50"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* In-App Notifications Feed */}
          <Card className="rounded-2xl border border-line/70 p-5 shadow-xs sm:p-6">
            <div className="mb-4 flex items-center justify-between border-b border-line/60 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-base font-bold text-ink-900">Placement Updates</h2>
                {unreadCount > 0 && (
                  <Badge tone="warning" className="rounded-full text-[10px]">
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              <span className="text-xs text-ink-500">
                Showing {visible.length} of {sorted.length}
              </span>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-8 text-center">
                <p className="text-sm font-medium text-ink-500">Nothing under this filter.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map((note) => {
                  const isUnread = !note.read;
                  const category = getNotificationCategory(note.kind);
                  const cfg = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.general;
                  const IconComp = cfg.icon;
                  const action = resolvePrimaryAction(note);

                  return (
                    <li
                      key={note.id}
                      className={`group relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                        isUnread
                          ? "border-brand-200 bg-gradient-to-br from-brand-50/60 via-white to-brand-50/20 p-5 shadow-xs hover:shadow-sm"
                          : "border-line/70 bg-surface p-5 shadow-xs hover:border-line hover:shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          {/* Kind Category Icon (Pure Lucide SVG, No Emojis) */}
                          <div
                            aria-hidden="true"
                            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105 ${
                              isUnread
                                ? `${cfg.bgLight} ${cfg.textColor} border ${cfg.borderLight} shadow-2xs`
                                : "bg-surface-muted border border-line text-ink-500"
                            }`}
                          >
                            <IconComp className="size-5" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cfg.bgLight} ${cfg.textColor}`}
                              >
                                {cfg.label}
                              </span>
                              <p className="font-heading text-base font-bold leading-snug text-ink-900">
                                {note.title}
                              </p>
                              {isUnread && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
                                  <span className="size-1.5 rounded-full bg-brand-600 animate-pulse" />
                                  New
                                </span>
                              )}
                            </div>

                            <p className="mt-1 text-sm leading-relaxed text-ink-700 [overflow-wrap:anywhere]">
                              <NotificationBody body={note.body} />
                            </p>

                            <OfferLetterLink
                              url={note.letterUrl}
                              name={note.letterName}
                              className="mt-2.5"
                            />

                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                              <span className="flex items-center gap-1 font-medium">
                                <Clock className="size-3.5 text-ink-400" />
                                {formatRelativeTime(note.createdAt)}
                              </span>
                              <span className="text-ink-400">&bull;</span>
                              <span>{onDate(note.createdAt)}</span>

                              {/* Reading Area Focus Button */}
                              <button
                                type="button"
                                onClick={() => setActiveReadingNote(note)}
                                className="cursor-pointer ml-auto inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-800 transition-colors"
                              >
                                <Layers className="size-3.5" />
                                Details
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                          {action && (
                            <div>
                              {action.isExternal ? (
                                <a
                                  href={action.href}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="cursor-pointer inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-brand-700 active:scale-95 transition-all"
                                >
                                  <action.icon className="size-3.5" />
                                  {action.label}
                                </a>
                              ) : (
                                <ButtonLink
                                  to={action.to}
                                  variant="secondary"
                                  size="sm"
                                  className="gap-1 text-xs"
                                >
                                  <action.icon className="size-3.5" />
                                  {action.label}
                                </ButtonLink>
                              )}
                            </div>
                          )}

                          {note.read ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="size-3.5" />
                              Read
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void markRead(note.id)}
                              className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-2xs transition-all hover:border-brand-400 hover:bg-brand-50 active:scale-95"
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

          {/* Dedicated "Read Notification Area" Slide-Over Focus Drawer */}
          {activeReadingNote && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Notification details"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
            >
              <button
                type="button"
                aria-label="Close reading view backdrop"
                onClick={() => setActiveReadingNote(null)}
                className="fixed inset-0 bg-black/40 cursor-default"
              />
              <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl sm:p-7 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${readingConfig.borderLight} ${readingConfig.bgLight} ${readingConfig.textColor}`}
                    >
                      <ReadingIcon className="size-3.5" />
                      {readingConfig.label}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-ink-500">
                      <Calendar className="size-3 text-ink-400" />
                      {onDate(activeReadingNote.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeReadingNote.read ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3.5" />
                        Read
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void markRead(activeReadingNote.id)}
                        className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors"
                      >
                        <CheckCircle2 className="size-3.5" />
                        Mark read
                      </button>
                    )}

                    <button
                      type="button"
                      aria-label="Close reading view"
                      onClick={() => setActiveReadingNote(null)}
                      className="cursor-pointer rounded-full p-1.5 text-ink-400 hover:bg-surface-muted hover:text-ink-700 transition-colors"
                    >
                      <X className="size-5" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div>
                  <h3 className="font-heading text-xl font-bold leading-snug text-ink-900">
                    {activeReadingNote.title}
                  </h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                    <Clock className="size-3.5 text-ink-400" />
                    Delivered {formatRelativeTime(activeReadingNote.createdAt)}
                  </p>
                </div>

                {/* Structured Metadata Grid */}
                {hasReadingMetadata && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-2xl border border-line/60 bg-surface-muted/50 p-4">
                    {readingMeta.company && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-600">
                          <Building2 className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                            Company
                          </p>
                          <p className="truncate text-xs font-bold text-ink-900">
                            {readingMeta.company}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.role && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-600">
                          <Tag className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                            Role
                          </p>
                          <p className="truncate text-xs font-bold text-ink-900">
                            {readingMeta.role}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.ctc && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
                          <Coins className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700">
                            Package / CTC
                          </p>
                          <p className="truncate text-xs font-bold text-brand-800">
                            {readingMeta.ctc}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.deadline && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
                          <Clock className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                            Deadline
                          </p>
                          <p className="truncate text-xs font-bold text-amber-900">
                            {readingMeta.deadline}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.mode && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-600">
                          <Layers className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                            Mode
                          </p>
                          <p className="truncate text-xs font-bold text-ink-900">
                            {readingMeta.mode}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.venue && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
                          <MapPin className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                            Venue
                          </p>
                          <p className="truncate text-xs font-bold text-sky-900">
                            {readingMeta.venue}
                          </p>
                        </div>
                      </div>
                    )}

                    {readingMeta.meetingLink && (
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                          {isDocumentLink(readingMeta.meetingLink) ? (
                            <FileText className="size-4" />
                          ) : (
                            <Video className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                            {isDocumentLink(readingMeta.meetingLink)
                              ? "Document"
                              : "Interview link"}
                          </p>
                          <p className="truncate text-xs font-bold text-emerald-900">
                            {isDocumentLink(readingMeta.meetingLink)
                              ? "Attached file"
                              : "Ready to join"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sanitized Message */}
                <div className="rounded-2xl border border-line bg-surface-muted/30 p-4 text-sm leading-relaxed text-ink-800 space-y-2 [overflow-wrap:anywhere]">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Message
                  </p>
                  <NotificationBody body={activeReadingNote.body} />
                </div>

                {/* Offer Letter if Attached */}
                {activeReadingNote.letterUrl && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                        <FileText className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-emerald-950">Official Offer Letter</p>
                        <p className="truncate text-xs text-emerald-700">
                          {activeReadingNote.letterName ?? "offer-letter.pdf"}
                        </p>
                      </div>
                    </div>
                    <a
                      href={activeReadingNote.letterUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 transition-all"
                    >
                      <FileDown className="size-3.5" />
                      Download
                    </a>
                  </div>
                )}

                {/* Direct Primary Action Button */}
                {readingAction && (
                  <div className="border-t border-line pt-4">
                    {readingAction.isExternal ? (
                      <a
                        href={readingAction.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="cursor-pointer inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-xs hover:bg-brand-700 active:scale-[0.99] transition-all"
                      >
                        <readingAction.icon className="size-4" />
                        {readingAction.label}
                      </a>
                    ) : (
                      <ButtonLink
                        to={readingAction.to}
                        variant="primary"
                        className="w-full justify-center gap-2 py-3 text-sm font-semibold rounded-2xl"
                      >
                        <readingAction.icon className="size-4" />
                        {readingAction.label}
                      </ButtonLink>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
