import type { ApplicationStage } from "./student-progress";
import type { DriveStatus } from "./types";

/**
 * N7 — the four answers a drive can have for one student (spec 2026-08-18,
 * approved; Karthik's list names recorded in the handover). Exactly one
 * applies: two would show the same drive twice, zero would hide a drive they
 * can read — both are bugs by definition.
 *
 * Since 2026-10-29 the Drives area renders only `to_apply` and `in_progress`:
 * a drive whose window has closed is not one the student can act on, and a
 * concluded application belongs to the dashboard's "My applications". The two
 * closed answers are still how the view excludes them.
 */
export const STUDENT_DRIVE_LISTS = [
  "to_apply",
  "in_progress",
  "not_applied_closed",
  "applied_closed",
] as const;

export type StudentDriveList = (typeof STUDENT_DRIVE_LISTS)[number];

export interface StudentDriveFacts {
  readonly applied: boolean;
  readonly driveStatus: DriveStatus;
  readonly applicationEnd: Date;
  /** From `applicationProgress`; null when the student never applied. */
  readonly stage: ApplicationStage | null;
}

/**
 * Which of the four lists this drive belongs to, for this student, now.
 *
 * "Closed" is judged from the STUDENT's side, not the drive's: a rejection at
 * round one ends the drive for them while it runs on for everyone else, and
 * leaving it under "in progress" would have them checking a door that has
 * already shut.
 */
export function classifyStudentDrive(facts: StudentDriveFacts, now: Date): StudentDriveList {
  if (facts.applied) {
    const concluded =
      facts.driveStatus === "completed" ||
      facts.stage === "selected" ||
      facts.stage === "not_selected";
    return concluded ? "applied_closed" : "in_progress";
  }

  const windowOpen = facts.driveStatus === "live" && now.getTime() < facts.applicationEnd.getTime();
  return windowOpen ? "to_apply" : "not_applied_closed";
}

export interface TimeLeft {
  readonly label: string;
  /** Under 24 hours: the card shows it hot. */
  readonly urgent: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "4 days left to apply" — shown on every To-apply card (Karthik: closing
 * time SHOWN, not merely filterable). Days while there are at least two,
 * hours inside that, minutes inside the final hour; never "0" of anything.
 *
 * When the window has not opened yet (`applicationStart` is in the future),
 * the label flips to "Opens in X days" so the chip and the refusal message
 * ("Applications for this drive have not opened yet.") tell the same story.
 */
export function describeTimeLeft(
  applicationEnd: Date,
  now: Date,
  applicationStart?: Date | null,
): TimeLeft {
  if (applicationStart != null && now.getTime() < applicationStart.getTime()) {
    const until = applicationStart.getTime() - now.getTime();
    if (until >= 2 * DAY) {
      return { label: `Opens in ${Math.floor(until / DAY)} days`, urgent: false };
    }
    if (until >= HOUR) {
      const hours = Math.floor(until / HOUR);
      return { label: `Opens in ${hours} ${hours === 1 ? "hour" : "hours"}`, urgent: false };
    }
    const minutes = Math.max(1, Math.floor(until / MINUTE));
    return {
      label: `Opens in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
      urgent: true,
    };
  }

  const left = applicationEnd.getTime() - now.getTime();
  if (left <= 0) return { label: "Applications closed", urgent: false };

  if (left >= 2 * DAY) {
    return { label: `${Math.floor(left / DAY)} days left to apply`, urgent: false };
  }
  if (left >= HOUR) {
    const hours = Math.floor(left / HOUR);
    return {
      label: `${hours} ${hours === 1 ? "hour" : "hours"} left to apply`,
      urgent: left < DAY,
    };
  }
  const minutes = Math.max(1, Math.floor(left / MINUTE));
  return {
    label: `${minutes} ${minutes === 1 ? "minute" : "minutes"} left to apply`,
    urgent: true,
  };
}

/** "Bengaluru, Chennai" → ["Bengaluru", "Chennai"]. Free text, so trimmed and de-blanked. */
export function parseLocations(workLocations: string): readonly string[] {
  return workLocations
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Case-insensitive: the filter offers values parsed from the same free text. */
export function matchesLocation(workLocations: string, location: string): boolean {
  if (location.trim() === "") return true;
  const wanted = location.trim().toLowerCase();
  return parseLocations(workLocations).some((part) => part.toLowerCase() === wanted);
}
