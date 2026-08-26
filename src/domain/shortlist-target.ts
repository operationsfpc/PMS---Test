/**
 * The recruiter's ask versus the shortlist actually about to be sent.
 * UAT 2026-08-26.
 *
 * D6 (2026-08-19) added an OPTIONAL target shortlist size "to steer by", and
 * the screen printed "2 of 1 selected" and saved anyway. Saving notifies the
 * students and schedules them for Round 1, so an over-shortlist is not a
 * cosmetic slip: students are told they are through when the recruiter asked
 * for fewer.
 *
 * The target remains ADVISORY — a pooled drive, a no-show buffer or a
 * recruiter phone call are all good reasons to send a different number. So
 * this rule produces a WARNING, never a refusal. The screen makes the
 * mismatch impossible to miss in the confirmation that already guards the
 * save; the Central CPC still decides.
 */

export type ShortlistTargetStatus = "no_target" | "on_target" | "over_target" | "under_target";

export interface ShortlistTargetCheck {
  readonly status: ShortlistTargetStatus;
  /** The parsed target, or null when none was usefully set. */
  readonly target: number | null;
  readonly count: number;
  /** count − target. Zero whenever there is nothing to compare. */
  readonly difference: number;
  /** The sentence to show, or null when there is nothing to say. */
  readonly message: string | null;
}

/**
 * A target is only a target when it is a whole number of seats, one or more.
 * Blank, zero, negative, fractional and junk all mean "no target set" — the
 * field is optional, and a half-filled field must never manufacture a
 * warning about a seat that does not exist.
 */
function parseTarget(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

function students(n: number): string {
  return n === 1 ? "1 student" : `${n} students`;
}

export function checkShortlistTarget(input: {
  readonly target: string | number | null | undefined;
  readonly count: number;
}): ShortlistTargetCheck {
  const target = parseTarget(input.target);
  const count = input.count;

  if (target === null) {
    return { status: "no_target", target: null, count, difference: 0, message: null };
  }

  const difference = count - target;
  if (difference === 0) {
    return { status: "on_target", target, count, difference: 0, message: null };
  }

  const gap = Math.abs(difference);
  const direction = difference > 0 ? "more" : "fewer";
  return {
    status: difference > 0 ? "over_target" : "under_target",
    target,
    count,
    difference,
    message: `${students(count)} selected against a target of ${target} — ${gap} ${direction} than the recruiter asked for.`,
  };
}
