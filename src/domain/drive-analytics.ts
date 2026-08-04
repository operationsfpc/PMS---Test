/**
 * Live drive figures. PRD §17.
 *
 * "Open drives and the time left; eligible versus applied; offers out of a
 * drive." The clock lives here rather than in a component for two reasons:
 * `Date.now()` inside a render cannot be tested, and a coordinator's laptop
 * clock is not the authority on when applications close. Every function takes
 * `now` explicitly (CLAUDE.md).
 */

import { percentOf } from "./math";

export type WindowState = "unscheduled" | "not_open" | "open" | "closed";

export interface ApplicationWindow {
  readonly state: WindowState;
  /** Ready to render: "4 days left", "Opens in 3 days", "Closed". */
  readonly label: string;
  /** Closing within the urgent window — worth chasing students about. */
  readonly urgent: boolean;
  /** Milliseconds until it closes; null unless it is open. */
  readonly closesInMs: number | null;
}

/** A drive closing inside this window is worth chasing students about. */
export const URGENT_HOURS = 48;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "1 day", never "1 days". */
const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/**
 * The largest unit that does not round to zero.
 *
 * Days are useless on the last day ("0 days left" is what a student reads as
 * "already closed"), and minutes are noise a week out.
 */
function humanise(ms: number): string {
  if (ms >= DAY) return plural(Math.floor(ms / DAY), "day");
  if (ms >= HOUR) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.max(1, Math.floor(ms / MINUTE)), "minute");
}

/**
 * Where a drive is in its application window.
 *
 * A drive with no window is `unscheduled`, not "closed": it has not been
 * published yet, and saying "Closed" would send a coordinator hunting for a
 * problem that does not exist. The closing instant itself counts as closed,
 * matching the database's `application_end` exclusive bound.
 */
export function applicationWindow(
  window: { readonly start: Date | null; readonly end: Date | null },
  now: Date,
): ApplicationWindow {
  const { start, end } = window;

  if (start === null || end === null) {
    return {
      state: "unscheduled",
      label: "No application window set",
      urgent: false,
      closesInMs: null,
    };
  }

  if (now.getTime() < start.getTime()) {
    return {
      state: "not_open",
      label: `Opens in ${humanise(start.getTime() - now.getTime())}`,
      urgent: false,
      closesInMs: null,
    };
  }

  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) {
    return { state: "closed", label: "Closed", urgent: false, closesInMs: null };
  }

  return {
    state: "open",
    label: `${humanise(remaining)} left`,
    urgent: remaining <= URGENT_HOURS * HOUR,
    closesInMs: remaining,
  };
}

/**
 * A share, capped at 100%.
 *
 * R5a lets the Central CPC open a prestige drive to everyone, so more students
 * can apply than the criteria alone admit. "140% applied" reads as a bug and
 * costs a conversation; 100% is the honest ceiling.
 */
export function conversionRate(part: number, whole: number): number {
  return Math.min(100, percentOf(part, whole));
}

export interface DriveOutcome {
  /** Of those eligible, how many applied. */
  readonly applicationRate: number;
  /** Of those who applied, how many ended with an offer. */
  readonly offerRate: number;
}

export function driveOutcome(counts: {
  readonly eligible: number;
  readonly applied: number;
  readonly offers: number;
}): DriveOutcome {
  return {
    applicationRate: conversionRate(counts.applied, counts.eligible),
    offerRate: conversionRate(counts.offers, counts.applied),
  };
}
