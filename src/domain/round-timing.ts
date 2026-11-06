/**
 * Round timing (2026-11-06): the day a round is set for decides when the
 * cycle may move past it.
 *
 * The Rounds & results screen gated Advance and completion on the DRIVE's
 * status and on how many students were marked Selected, but on nothing about
 * time: a coordinator could advance everyone out of a Technical interview
 * scheduled for next Thursday, and complete a drive whose final round had not
 * happened. Both now ask the round's own date first.
 *
 * Two rules keep this from becoming a lock:
 * - A round with NO date is never blocked. Most drives in the system were
 *   built before the field existed, and an absent fact is not evidence.
 * - Time still cannot strand a drive: completing ahead of an undelivered
 *   round is allowed with the same typed, audit-logged reason that early
 *   completion already required.
 *
 * `now` is always passed in, never read from the wall clock (drive-aging's
 * rule), so every one of these decisions is testable.
 */

import { MIN_EARLY_REASON } from "./drive-completion";
import type { Permission } from "./rounds";

/** A round, only as far as its own schedule is concerned. */
export interface RoundSchedule {
  readonly sequence: number;
  readonly name: string;
  /** `drive_rounds.scheduled_at`, or the datetime-local read-back of it. */
  readonly scheduledAt: string | null;
}

export type RoundTiming = "unset" | "upcoming" | "past";

/**
 * What the round's date says about where the cycle stands.
 *
 * A value the clock cannot read is `unset` — a malformed date must not be
 * allowed to refuse an action any more than a missing one can.
 */
export function roundTiming(scheduledAt: string | null | undefined, now: Date): RoundTiming {
  const when = instantOf(scheduledAt);
  if (when === null) return "unset";
  return when.getTime() > now.getTime() ? "upcoming" : "past";
}

/**
 * The instant a round's stored date means, or null when there is nothing to
 * compare against.
 *
 * `scheduled_at` reaches this module in two shapes. The database's own
 * timestamptz carries its offset. The editable value — what
 * `toDatetimeLocal` hands the screen and what Save sends back — is a bare
 * `2026-09-01T10:30`, and it MEANS IST (results-view stamps it `+05:30`).
 * Reading that bare value as the viewer's local time would put a round
 * already held in Chennai into next week for a reader in London.
 */
function instantOf(scheduledAt: string | null | undefined): Date | null {
  if (scheduledAt === null || scheduledAt === undefined || scheduledAt === "") return null;
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(scheduledAt);
  const iso = bare
    ? `${scheduledAt.length === 16 ? `${scheduledAt}:00` : scheduledAt}+05:30`
    : scheduledAt;
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * "19 Aug 2026, 10:30 am" — the round's own moment, in the calendar the
 * placement office reads. Null when the round has no readable date.
 */
export function describeRoundWhen(scheduledAt: string | null | undefined): string | null {
  const when = instantOf(scheduledAt);
  if (when === null) return null;
  return when.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Round 2 (Technical interview) — how a gate names the round it is refusing. */
const named = (round: RoundSchedule): string => `Round ${round.sequence} (${round.name})`;

/**
 * May anyone be advanced OUT of this round yet?
 *
 * The gate is on the round being LEFT, not the one being entered: advancing
 * is what schedules students for the next round, so waiting for the NEXT
 * round's date would make scheduling, attendance and per-student meeting
 * slots impossible to do in advance — which is the whole point of them.
 */
export function canAdvanceFrom(round: RoundSchedule, now: Date): Permission {
  if (roundTiming(round.scheduledAt, now) !== "upcoming") return { allowed: true };
  const when = describeRoundWhen(round.scheduledAt);
  return {
    allowed: false,
    reason: `${named(round)} is scheduled for ${when ?? "a later date"} and has not been held yet — advance it once that time has passed.`,
  };
}

/**
 * The rounds still ahead of their own date, in the order the cycle reaches
 * them. Undated rounds are never among them (F1: progression is linear, so
 * the lowest sequence still to come is the next one).
 */
export function roundsAhead(rounds: readonly RoundSchedule[], now: Date): readonly RoundSchedule[] {
  return rounds
    .filter((round) => roundTiming(round.scheduledAt, now) === "upcoming")
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * The one sentence the completion popup leads with when a round is still to
 * come, or null when nothing is ahead of itself.
 */
export function describeRoundsAhead(ahead: readonly RoundSchedule[]): string | null {
  const next = ahead[0];
  if (next === undefined) return null;
  const when = describeRoundWhen(next.scheduledAt);
  return `${named(next)} is scheduled for ${when ?? "a later date"} and has not been held yet`;
}

/**
 * May the drive be completed while a round it planned has not been held?
 *
 * Only with a reason — the same escape Batch C gave early completion, for the
 * same honest reason: drives fizzle, and a drive stuck "in rounds" is a lie on
 * every screen that counts it. Here the reason is asked for even when every
 * student has an outcome, because skipping a round nobody sat is a different
 * decision from closing a process that ran out of students.
 */
export function decideCompletionTiming(
  ahead: readonly RoundSchedule[],
  reason: string,
): Permission {
  const hold = describeRoundsAhead(ahead);
  if (hold === null) return { allowed: true };
  if (reason.trim().length < MIN_EARLY_REASON) {
    return {
      allowed: false,
      reason:
        `${hold}. ` +
        (ahead.length === 1
          ? "Give a reason for completing the drive before it"
          : `${ahead.length} rounds are still to come; give a reason for completing the drive before them`) +
        " — it is audit-logged.",
    };
  }
  return { allowed: true };
}
