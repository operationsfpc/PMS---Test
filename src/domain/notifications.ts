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

/**
 * Spec C (2026-08-21, approved 2026-08-24): a notification body split into
 * text and URL segments, so the screens can render the URLs as links.
 *
 * Pure and shared: the notifications page and the dashboard panel render the
 * SAME segments, so a link can never be live on one screen and dead on the
 * other. Trailing punctuation stays text — "…workers.dev/." is a sentence
 * ending, not a path — because a 404 the student cannot explain is worse
 * than no link at all.
 */
export interface BodySegment {
  readonly kind: "text" | "link" | "bold";
  readonly text: string;
}

const TRAILING_PUNCTUATION = /[.,;)\]}!?]+$/;

export function linkifyBody(body: string): readonly BodySegment[] {
  const segments: BodySegment[] = [];
  let cursor = 0;

  // Combined pattern: match **bold** or URLs, whichever comes first
  const COMBINED = /\*\*[^*]+\*\*|https?:\/\/[^\s]+/g;

  for (const match of body.matchAll(COMBINED)) {
    const raw = match[0];
    const start = match.index ?? 0;

    if (start > cursor) segments.push({ kind: "text", text: body.slice(cursor, start) });

    if (raw.startsWith("**")) {
      segments.push({ kind: "bold", text: raw.slice(2, -2) });
      cursor = start + raw.length;
    } else {
      const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
      segments.push({ kind: "link", text: trimmed });
      cursor = start + trimmed.length;
    }
  }

  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });

  return segments;
}

/**
 * Whether this notification is the one an offer letter belongs under.
 *
 * UAT 2026-08-27: the CPC attaches the letter to the offer (`0062`), the
 * student is notified of the offer — and had nowhere to open it. The letter is
 * now offered on the notification itself.
 *
 * Only the offer's own kind qualifies. A placed student still receives round
 * schedules for that same drive, and hanging the letter off anything that
 * merely SHARES the drive would put "View offer letter" under "You cleared
 * Round 3" — a different message wearing the offer's clothes.
 */
export function notificationCarriesOfferLetter(kind: string): boolean {
  return kind === "offer";
}

/**
 * High-level notification categories for UI filtering and visual badging.
 * Zero emojis — clean enterprise categorisation.
 */
export type NotificationCategory = "drive" | "interview" | "offer" | "profile" | "general";

export function getNotificationCategory(kind: string): NotificationCategory {
  switch (kind) {
    case "drive_published":
    case "drive_deadline_reminder":
    case "application_confirmed":
    case "campus_drive_alert":
      return "drive";
    case "shortlisted":
    case "round_scheduled":
    case "meeting_link":
    case "interview_day_reminder":
    case "round_cleared":
    case "round_not_selected":
      return "interview";
    case "offer":
    case "self_placement_decision":
    case "super_dream_milestone":
      return "offer";
    case "srf_approved":
    case "srf_rejected":
    case "welcome":
    case "opt_out_confirmed":
    case "absent":
      return "profile";
    default:
      return "general";
  }
}

export interface ExtractedNotificationMetadata {
  readonly company?: string;
  readonly role?: string;
  readonly ctc?: string;
  readonly deadline?: string;
  readonly venue?: string;
  readonly meetingLink?: string;
  readonly mode?: string;
}

/**
 * Extracts structured metadata fields from notification bodies so the in-app
 * view can render crisp info chips rather than a wall of email text.
 */
export function extractNotificationMetadata(body: string): ExtractedNotificationMetadata {
  const meta: Record<string, string> = {};

  const companyMatch = body.match(/\*\*Company:\*\*\s*([^\n]+)/i);
  if (companyMatch?.[1]) meta.company = companyMatch[1].trim();

  const roleMatch = body.match(/\*\*Role:\*\*\s*([^\n]+)/i);
  if (roleMatch?.[1]) meta.role = roleMatch[1].trim();

  const ctcMatch = body.match(/\*\*(?:CTC Range|CTC):\*\*\s*([^\n]+)/i);
  if (ctcMatch?.[1]) meta.ctc = ctcMatch[1].trim();

  const deadlineMatch = body.match(/\*\*Application Deadline:\*\*\s*([^\n]+)/i);
  if (deadlineMatch?.[1]) meta.deadline = deadlineMatch[1].trim();

  const venueMatch = body.match(/(?:\.|\n|^)\s*Venue:\s*([^.\n]+)/i);
  if (venueMatch?.[1]) meta.venue = venueMatch[1].trim();

  const linkMatch = body.match(/(?:Join at:|meeting link:)\s*(https?:\/\/[^\s]+)/i);
  if (linkMatch?.[1]) meta.meetingLink = linkMatch[1].trim().replace(/[.,;)\]}]+$/, "");

  const modeMatch = body.match(/(?:•\s*\*\*Mode:\*\*|Mode:)\s*([^\n.]+)/i);
  if (modeMatch?.[1]) meta.mode = modeMatch[1].trim();

  return meta;
}

/**
 * Strips out redundant email boilerplate from notification messages for in-app viewing:
 * - "Log in to the portal at..."
 * - "Please sign in with your registered Google account..."
 * - Email signatures and salutations
 */
export function cleanNotificationBody(body: string): string {
  return body
    .replace(/(?:Please\s+)?(?:Log in|Sign in)\s+to\s+the\s+portal[^\n.]*(?:\.|$)/gi, "")
    .replace(
      /Please\s+sign\s+in\s+with\s+your\s+registered\s+Google\s+account[^\n.]*(?:\.|$)/gi,
      "",
    )
    .replace(/Dear\s+(?:Candidate|Student)[^\n,]*,?/gi, "")
    .replace(/Warm\s+regards,?\s*(?:Placement\s+Cell,?)?\s*(?:FACE\s+Prep\s+Campus)?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * User-friendly relative time string (e.g. "Just now", "15m ago", "2h ago", "Yesterday").
 * Guaranteed zero emojis.
 */
export function formatRelativeTime(iso: string, referenceTime: number = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";

  const diffMs = referenceTime - timestamp;
  if (diffMs < 0) return "Just now";

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
