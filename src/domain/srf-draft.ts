/**
 * Resuming a saved registration form.
 *
 * UAT 2026-08-05 asked for a draft so students can "continue the registration
 * later without losing their data". Restoring one is not a straight overwrite,
 * because three sources disagree and the order between them is a rule:
 *
 *   roster  >  draft  >  defaults
 *
 * IDENTITY ALWAYS COMES FROM THE ROSTER. A draft can be weeks old, and the
 * college may have corrected a roll number, a branch or a passing year since
 * it was written. Letting the draft win would silently restore the stale value
 * and send it for verification, where it fails against the marksheet — and the
 * student is the one who gets blamed for it. Those fields are disabled in the
 * form for exactly this reason; the draft must not be a way around that.
 */

/** The fields the roster owns. Never restored from a draft. */
const ROSTER_OWNED = [
  "fullName",
  "rollNumber",
  "email",
  "degree",
  "branch",
  "passingYear",
] as const;

export type RosterOwnedField = (typeof ROSTER_OWNED)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The form state to open with.
 *
 * Unknown keys in the draft are dropped: a draft written by an older version
 * of the form can carry fields the schema no longer has, and letting them
 * through would fail validation on a field the student cannot even see.
 */
export function mergeSrfDraft<TValues extends Record<string, unknown>>(
  defaults: TValues,
  roster: Partial<Record<RosterOwnedField, unknown>> | null,
  draft: unknown,
): TValues {
  const merged: Record<string, unknown> = { ...defaults };

  if (isRecord(draft)) {
    for (const key of Object.keys(defaults)) {
      if (key in draft) merged[key] = draft[key];
    }
  }

  // Last, so it wins over anything the draft restored.
  if (roster !== null) {
    for (const field of ROSTER_OWNED) {
      const value = (roster as Record<string, unknown>)[field];
      if (value !== undefined) merged[field] = value;
    }
  }

  return merged as TValues;
}
