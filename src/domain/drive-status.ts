/**
 * How a drive's LIFECYCLE is named and coloured, on every screen.
 *
 * The same eight values were spelled eight ways: the canonical drive page said
 * "LIVE", the cockpit said `live` (the raw column with its underscores spaced),
 * the AE overview said "Applications open", the PIF event picker said "Pending
 * approval" for what every other screen calls "Awaiting approval", and
 * `approved` was green on one screen and amber on the next. A drive that reads
 * differently on two screens is two drives to the person reading them — which
 * is exactly what the coordinator is trying to count.
 *
 * The colours carry one meaning each, so a badge can be read without its words:
 *   neutral — nothing is in flight (a draft; a finished drive)
 *   warning — someone owes the next step (approval, publishing, a first round)
 *   success — students can act on it right now (the only green badge here)
 *   danger  — it is dead (a PIF sent back, which is never reopened)
 *
 * `approved` is warning rather than success on purpose: an approved drive is
 * still invisible to every student until the Central CPC publishes it, so
 * colouring it like a live one would hide the step that is missing.
 */

import type { DriveStatus } from "./types";
import { DRIVE_STATUSES } from "./types";

/** The badge's colour, named by intent. A subset of the UI's `Tone`. */
export type DriveStatusTone = "neutral" | "warning" | "success" | "danger";

const LABEL: Readonly<Record<DriveStatus, string>> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved — not yet published",
  live: "Live",
  applications_closed: "Applications closed",
  in_rounds: "In rounds",
  completed: "Completed",
  // Not "Rejected": the Delivery Head sends a PIF back for a fresh one, and a
  // word that reads as a verdict on the company is not what happened.
  rejected: "Sent back",
};

const TONE: Readonly<Record<DriveStatus, DriveStatusTone>> = {
  draft: "neutral",
  submitted: "warning",
  approved: "warning",
  live: "success",
  applications_closed: "warning",
  in_rounds: "warning",
  completed: "neutral",
  rejected: "danger",
};

/**
 * Narrows a raw column value. Screens that read a drive row hold `status` as a
 * plain string, and an unrecognised status must still be readable rather than
 * blank — so it comes back as stored, with its underscores spaced.
 */
function asStatus(raw: string): DriveStatus | null {
  return DRIVE_STATUSES.find((status) => status === raw) ?? null;
}

export function driveStatusLabel(status: string): string {
  const known = asStatus(status);
  return known === null ? status.replaceAll("_", " ") : LABEL[known];
}

/** An unknown status is quiet: it is a data gap, not somebody's alarm. */
export function driveStatusTone(status: string): DriveStatusTone {
  const known = asStatus(status);
  return known === null ? "neutral" : TONE[known];
}
