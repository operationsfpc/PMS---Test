import type { AppRole, HoldKind } from "./types";

/**
 * A hold is the college's own, temporary block on one student's placements
 * (0125), asked for 2026-10-29: "campus manager can able to hold drives from
 * student and no notification can able to get to students".
 *
 * Three decisions the screens must keep honouring:
 *
 *  - `ends_at` is a REVIEW date, never a switch. Nothing in the database
 *    releases a hold on a date — no cron, no trigger — because a fee that goes
 *    unpaid does not clear itself by Tuesday. A past date means "somebody
 *    should look at this again", so the screens say that and stop.
 *  - Release is a person's action (0125's `release_student_hold`), which is why
 *    every standing below distinguishes "still on" from "someone lifted it".
 *  - The student is told on screen and never by mail (0126 stops their
 *    notifications the moment the hold lands), so the words here are the only
 *    explanation they get.
 */

/** What the college calls each reason, on a chip or a dropdown. */
export const HOLD_KIND_LABELS: Record<HoldKind, string> = {
  fees: "Fees",
  self_placed: "Self-placed",
  idle: "Not applying",
};

/** The same three, said as a sentence to a coordinator deciding one. */
export const HOLD_KIND_DESCRIPTIONS: Record<HoldKind, string> = {
  fees: "Held until their dues are cleared with accounts.",
  self_placed: "They found a job off-campus; drives are closed to them.",
  idle: "Not applying to anything, however long the window stays open.",
};

/**
 * Who is told a hold exists.
 *
 * The near-side mirror of 0125's two select policies
 * (`campus_manager_reads_own_college_holds`, `org_readers_see_every_hold`):
 * the escalation path for a fee hold runs through the org roles, and a screen
 * that drew nothing for them would hide the reason a student stopped appearing
 * in every drive list. RLS is still what refuses — this only decides whether a
 * record page asks the question at all, so a company role does not spend two
 * reads on a block they are never allowed to see.
 */
export const HOLD_READER_ROLES: readonly AppRole[] = [
  "campus_manager",
  "admin",
  "central_placement_coordinator",
  "delivery_head",
  "ceo",
  "er_head",
  "enterprise_relations",
];

/** And who may take one off: the college that put it on (0125's release RPC). */
export const canReleasePlacementHold = (role: AppRole): boolean => role === "campus_manager";

export interface HoldWindow {
  readonly kind: HoldKind;
  /** ISO `YYYY-MM-DD`, as the date column is read. */
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly releasedAt: string | null;
}

/**
 * Whether the hold is still doing something, and whether its review date has
 * gone by.
 *
 * `overdue` does NOT mean released: the student is still held, and a screen
 * that treated the date as a switch would put them back in placements nobody
 * approved.
 */
export type HoldStanding = "released" | "open" | "overdue";

/**
 * `today` is injected so the screens and the tests share one clock, the same
 * way `canApply` takes it.
 */
export function holdStanding(hold: HoldWindow, today: Date): HoldStanding {
  if (hold.releasedAt !== null) return "released";
  if (hold.endsAt === null) return "open";
  // Compared as dates, not timestamps: `ends_at` is a day, and a day is not
  // over until the whole of it has passed.
  const review = new Date(`${hold.endsAt}T23:59:59`);
  return review < today ? "overdue" : "open";
}

/**
 * How a hold's window reads on one line: "from 29 Oct 2026, review by 15 Dec",
 * or the release once there is one.
 *
 * A hold with no review date says so rather than going quiet — "no review date"
 * is a fact the coordinator set by leaving the box empty, and the manager who
 * inherits the row needs to see that nobody ever meant to look again.
 */
export function holdWindowLine(hold: HoldWindow, today: Date): string {
  if (hold.releasedAt !== null) return `released ${formatDay(hold.releasedAt)}`;
  const standing = holdStanding(hold, today);
  if (hold.endsAt === null) return `from ${formatDay(hold.startsAt)}, no review date`;
  return `from ${formatDay(hold.startsAt)}, ${
    standing === "overdue" ? "review was due" : "review by"
  } ${formatDay(hold.endsAt)}`;
}

/** The bucket's own ceiling (0125), and `student_documents.size_bytes`' check (0003). */
export const HOLD_ORDER_MAX_BYTES = 5 * 1024 * 1024;

/** What the hold dialog holds before it is sent — everything as typed. */
export interface HoldDraft {
  readonly kind: HoldKind | null;
  readonly reason: string;
  /** `YYYY-MM-DD`, or "" when the box is empty. */
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * The first thing wrong with a draft, in words the manager can act on, or null
 * when it can be placed.
 *
 * The database refuses the same shape (0125's `trim(reason) <> ''` check and
 * `hold_window_is_ordered`); asking here is what stops the manager from finding
 * out after their attachment has already been uploaded.
 */
export function holdDraftProblem(draft: HoldDraft): string | null {
  if (draft.kind === null) return "Choose what the hold is for.";
  if (draft.reason.trim() === "")
    return "Give the reason — it is what the student is told, and what a release is judged against.";
  if (draft.startsAt === "") return "Say when the hold starts.";
  // ISO dates order correctly as text, which is why the boxes hold YYYY-MM-DD.
  if (draft.endsAt !== "" && draft.endsAt < draft.startsAt)
    return "The review date cannot fall before the hold starts.";
  return null;
}

/** "2026-10-29" or a timestamp, printed as "29 Oct 2026". */
function formatDay(value: string): string {
  // A `date` column reads as midnight UTC and a `timestamptz` as a moment; both
  // start with the same ten characters, so the day is taken from there rather
  // than from a Date that would slide a local evening back into the day before.
  const iso = value.slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
