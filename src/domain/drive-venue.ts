/**
 * The drive's venue — where an off-campus drive physically happens.
 * UAT 2026-08-21, item 2.
 *
 * Distinct from 0004's per-ROUND `venue` (written since G6b): this is the
 * drive-level fact the AE hears from the company, often before it is final.
 * "Venue not yet confirmed" is the ABSENCE of a venue, not a venue — one
 * fact, one nullable column, no boolean to drift out of step with it.
 */

import type { AppRole, DriveMode } from "./types";

/** The modes that happen at a venue the college does not own. Answer Q4: both. */
const VENUE_MODES: readonly DriveMode[] = ["physical_outside_campus", "pooled"];

/** Whether this drive mode has an off-campus venue to record at all. */
export function driveVenueApplies(mode: DriveMode | "" | null | undefined): boolean {
  return mode != null && mode !== "" && VENUE_MODES.includes(mode);
}

/**
 * The one line a screen prints for the venue.
 *
 * Null when the mode has no venue (on campus, online, or not chosen yet) —
 * print nothing. When the mode has one and it is not recorded, say so:
 * silence would read as "no venue exists", and a student planning travel to
 * an off-site drive deserves "to be confirmed" over a blank.
 */
export function describeDriveVenue(
  mode: DriveMode | "" | null | undefined,
  venue: string | null | undefined,
): string | null {
  if (!driveVenueApplies(mode)) return null;
  const trimmed = (venue ?? "").trim();
  return trimmed === "" ? "Venue to be confirmed" : trimmed;
}

/**
 * Who may record or correct the venue after the PIF is submitted.
 *
 * Exactly the Central Placement Coordinator (answer Q5, 2026-08-21): they
 * follow up with the company once the venue is confirmed. Not the AE — one
 * verb, one role (0047). Enforced here for the UI; RLS lets any operator
 * update drives, so the button is the gate that matters day to day.
 */
export function canEditDriveVenue(role: AppRole): boolean {
  return role === "central_placement_coordinator";
}
