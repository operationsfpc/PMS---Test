import type { ApplicationStage } from "./student-progress";
import type { DriveStatus } from "./types";

/**
 * N7 — the student's Drives area is four lists (spec 2026-08-18, approved;
 * Karthik's list names recorded in the handover). A drive a student can see
 * is in EXACTLY one of them: two lists would show the same drive twice, zero
 * would hide a drive they can read — both are bugs by definition.
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
 */
export function describeTimeLeft(applicationEnd: Date, now: Date): TimeLeft {
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

/** The closing-time filter's options, in the order the screen offers them. */
export const CLOSING_FILTERS = ["any", "today", "3_days", "7_days"] as const;

export type ClosingFilter = (typeof CLOSING_FILTERS)[number];

const CLOSING_HORIZON: Readonly<Record<Exclude<ClosingFilter, "any">, number>> = {
  today: DAY,
  "3_days": 3 * DAY,
  "7_days": 7 * DAY,
};

/**
 * Whether a drive's window closes inside the filter's horizon. A closed
 * window matches nothing — including "any": this filter only ever runs over
 * the To-apply list, where a closed drive has no business appearing.
 */
export function closesWithin(applicationEnd: Date, now: Date, filter: ClosingFilter): boolean {
  const left = applicationEnd.getTime() - now.getTime();
  if (left <= 0) return false;
  if (filter === "any") return true;
  return left <= CLOSING_HORIZON[filter];
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
