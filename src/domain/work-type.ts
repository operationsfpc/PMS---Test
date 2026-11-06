/**
 * How a role's WORK TYPE is named.
 *
 * 2026-11-06: the PIF asks the AE "Hybrid, Work from home or Work from
 * office?" per role. Three screens read that answer back — the student's
 * cards, the drive record and the approval queue — so it gets one spelling
 * here rather than three, which is the mistake `drive-type.ts` exists to
 * undo (the PIF said "Internship (convertible)", the publish view printed
 * "internship convertible", the card printed the raw value).
 *
 * It is NOT `drive_mode`: that says how the SELECTION is run (on campus,
 * virtual, pooled), which is a different question from where the job is. Nor
 * is it `work_locations`: that is free text an AE types — "Remote + Delhi",
 * "Chennai, Hyderabad" — and nothing can read a work mode out of it reliably.
 */

import type { WorkType } from "./types";
import { WORK_TYPES } from "./types";

const LABEL: Readonly<Record<WorkType, string>> = {
  hybrid: "Hybrid",
  work_from_home: "Work from home",
  work_from_office: "Work from office",
};

/**
 * The work type, in words. Null is a question the AE never answered, and it
 * says so — an empty badge on a student's card reads as a rendering fault,
 * the same way "Type not set" does for a drive with no type.
 *
 * A card that hides its work type when nothing was stated checks the value,
 * not this string: `asWorkType(row.work_type) === null`.
 */
export function workTypeLabel(type: WorkType | null): string {
  return type === null ? "Not stated" : LABEL[type];
}

/**
 * Narrows a raw column value — anything unrecognised, including the empty
 * string, means "not stated".
 *
 * Views carry `work_type` as a plain string read straight off the row, so a
 * screen needs a way to ask the domain what it holds instead of printing it.
 */
export function asWorkType(raw: string | null | undefined): WorkType | null {
  return WORK_TYPES.find((type) => type === raw) ?? null;
}
