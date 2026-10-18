/**
 * Whether a drive's own state still allows the verb a screen is offering.
 *
 * 2026-10-18 (UAT, live): the coordinator's screens offered every action no
 * matter what the drive's status was — a completed drive could still be
 * shortlisted, a drive that had never been published could be marked
 * completed, a rejected one could still be given rounds. Each verb has one
 * answer here, and the screens show the sentence rather than hiding the
 * control: a vanished button reads as a defect, a locked one that says why
 * reads as a rule (G6c's precedent, `describeRoundFreeze`).
 */

import type { DriveStatus } from "./types";
import { DRIVE_STATUSES } from "./types";

/**
 * A status read off a row that types it as a plain string.
 *
 * The `company_drives` table carries the same vocabulary as `drives.status` but
 * arrives through a loose column, and guessing "draft" for a value this file
 * does not know would open a verb on a drive that may be closed. Unknown is
 * reported as unknown, which every gate above already treats as no evidence.
 */
export function asDriveStatus(value: string | null | undefined): DriveStatus | null {
  return typeof value === "string" && DRIVE_STATUSES.includes(value as DriveStatus)
    ? (value as DriveStatus)
    : null;
}

/**
 * The verb the screen is about to offer.
 *
 * `shortlist`, `offers` and `completion` all need applicants, so all three are
 * closed until the drive has been published. `rounds` and `roles` are
 * deliberately NOT: §3.5 requires at least one round BEFORE go live, and a
 * visit is assembled role by role before it is announced, so freezing either on
 * an unpublished drive would make a drive impossible to publish.
 */
export type DriveVerb = "shortlist" | "offers" | "rounds" | "completion" | "roles";

/** Statuses in which no student has yet been told the drive exists. */
const UNPUBLISHED: readonly DriveStatus[] = ["draft", "submitted", "approved"];

/**
 * Why this verb is refused — or null when the drive's state allows it.
 *
 * A `null` status means the drive has not been read yet (or the reader does
 * not carry the column), which is evidence of nothing: the screen stays as it
 * was rather than locking itself on a missing fact.
 */
export function describeDriveFreeze(verb: DriveVerb, status: DriveStatus | null): string | null {
  if (status === null) return null;

  if (status === "completed") {
    return verb === "completion"
      ? "This drive is already completed."
      : "This drive is completed — its record is closed.";
  }

  if (status === "rejected") {
    return "This drive was rejected — nothing more can be recorded against it.";
  }

  if (!UNPUBLISHED.includes(status)) return null;

  if (verb === "rounds" || verb === "roles") return null;

  return verb === "completion"
    ? "This drive has not been published, so there is nothing to complete."
    : "This drive has not been published yet, so no student has applied to it.";
}
