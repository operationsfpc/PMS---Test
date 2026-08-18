/**
 * The shift a role is worked on. Asked for 2026-08-18:
 *
 *   "Shift time, instead of a text box, change to radio button — Day and Night
 *    as options with time to be filled as text for night box."
 *
 * Rotational / Flexible were added at approval (answer 5): both are ordinary
 * in the hiring FACE Prep does, and adding a value now costs a word, whereas
 * adding it after a hundred drives have been raised costs a migration and a
 * backfill decision.
 *
 * Only NIGHT carries hours, because that is the only answer a student cannot
 * plan around without them. The pairing is validated here rather than in the
 * form because `0051` refuses the same shape in SQL, and the two must not be
 * able to disagree.
 *
 * ⚠️ There is no backfill. The four live drives say `shift_type = 'General'`,
 * which is what an AE typed; deciding it means "day" would invent a fact
 * nobody stated. `describeShift` therefore repeats an unrecognised value
 * verbatim and reads a missing one as "Not recorded".
 */

export const SHIFT_TYPES = ["day", "night", "rotational", "flexible"] as const;

export type ShiftType = (typeof SHIFT_TYPES)[number];

export function isShiftType(value: string): value is ShiftType {
  return (SHIFT_TYPES as readonly string[]).includes(value);
}

const LABELS: Record<ShiftType, string> = {
  day: "Day",
  night: "Night",
  rotational: "Rotational",
  flexible: "Flexible",
};

export function shiftLabel(shift: ShiftType): string {
  return LABELS[shift];
}

/**
 * What a reader is told about the shift — the student's drive card, the
 * approver's queue, an export.
 *
 * The timing is only ever shown against a night shift, whatever the row says.
 * A stale timing beside "Day shift" would read as a contradiction the reader
 * has no way to resolve.
 */
export function describeShift(
  shift: string | null | undefined,
  nightTiming: string | null | undefined,
): string {
  const value = (shift ?? "").trim();
  if (value === "") return "Not recorded";
  if (!isShiftType(value)) return value;

  const timing = (nightTiming ?? "").trim();
  if (value === "night" && timing !== "") return `Night shift (${timing})`;

  return `${LABELS[value]} shift`;
}

/**
 * The timing that may be stored against this shift.
 *
 * Choosing Night, typing the hours and then switching to Day must not leave
 * the hours behind — the row would then claim a day shift that runs at night,
 * and the check constraint in `0051` would refuse the write anyway.
 */
export function nightTimingFor(shift: string, nightTiming: string): string {
  return shift === "night" ? nightTiming.trim() : "";
}

/** A night shift with no hours is not a submittable answer (a draft may be). */
export function nightTimingIsMissing(shift: string, nightTiming: string): boolean {
  return shift === "night" && nightTiming.trim() === "";
}
