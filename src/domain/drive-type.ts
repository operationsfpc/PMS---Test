/**
 * How a drive's TYPE is named, coloured and filtered.
 *
 * Karthik, 2026-08-27: a type filter at the top of every drive list, and a
 * small type tag on every drive card.
 *
 * Both live here rather than in the five screens that show them. Before this
 * module the same three values were spelled four different ways — the PIF form
 * said "Internship (convertible)", the publish view printed
 * `drive_type.replaceAll("_", " ")` → "internship convertible", the portfolio
 * card printed the raw value, and the student's profile had its own list. A
 * drive that reads differently on two screens is two drives to the person
 * reading them.
 */

import type { DriveType } from "./types";
import { DRIVE_TYPES } from "./types";

/** The tag's colour, named by intent rather than by hex. */
export type DriveTypeTone = "neutral" | "accent" | "warning";

const LABEL: Readonly<Record<DriveType, string>> = {
  // "Placement" was the stored word and the screen word. The business says
  // "full time", so the screens now say it too (2026-08-27).
  placement: "Full time",
  // The arrow carries the whole idea: it STARTS as an internship and becomes
  // the other thing. "Internship (convertible)" left the reader to guess into
  // what.
  internship_convertible: "Internship → Full time",
  internship: "Internship",
};

const TONE: Readonly<Record<DriveType, DriveTypeTone>> = {
  placement: "neutral",
  internship_convertible: "accent",
  internship: "warning",
};

/**
 * The type, in words. Null is a drive that never declared one — said plainly,
 * because an empty tag looks like a rendering fault.
 */
export function driveTypeLabel(type: DriveType | null): string {
  return type === null ? "Type not set" : LABEL[type];
}

/** The tag's tone. An undeclared type is quiet rather than alarming. */
export function driveTypeTone(type: DriveType | null): DriveTypeTone {
  return type === null ? "neutral" : TONE[type];
}

/** What the filter can be set to. `""` is "All" — the default everywhere. */
export type DriveTypeFilter = "" | DriveType;

export interface DriveTypeFilterOption {
  readonly value: DriveTypeFilter;
  readonly label: string;
}

/** The filter's options, All first, then the types in business order. */
export const DRIVE_TYPE_FILTERS: readonly DriveTypeFilterOption[] = [
  { value: "", label: "All" },
  ...DRIVE_TYPES.map((type) => ({ value: type, label: LABEL[type] })),
];

/**
 * Whether a drive belongs in the filtered list.
 *
 * A drive with no type matches only "All": letting it fall into a named
 * bucket would tell the reader something the data never said.
 */
export function matchesDriveType(type: DriveType | null, filter: DriveTypeFilter): boolean {
  return filter === "" || type === filter;
}

/** Narrows a URL parameter — anything unrecognised means "All". */
export function asDriveTypeFilter(raw: string | null | undefined): DriveTypeFilter {
  return DRIVE_TYPES.find((type) => type === raw) ?? "";
}
