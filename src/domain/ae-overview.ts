/**
 * The Account Executive's landing page — their own work, in six figures.
 *
 * Approved 2026-08-26. The AE had no overview at all: `/dashboard` is built on
 * the student roster, which they cannot read (`0018`), so it would have
 * rendered "No students yet" for them.
 *
 * Which drives count is RLS's answer and not this function's. An AE is
 * returned only the drives they raised; re-filtering on `created_by` here
 * would be a second, weaker copy of a rule the database already enforces.
 */

import type { DriveStatus } from "./types";

/** What an applicant contributes to the totals. The same two facts Live counts. */
export interface AeApplicant {
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
}

export interface AeDrive {
  readonly status: DriveStatus;
  readonly applicants: readonly AeApplicant[];
}

export interface AeDriveTotals {
  /** Every drive they raised, whatever became of it. */
  readonly broughtIn: number;
  /** Published and still open — not everything merely unfinished. */
  readonly liveNow: number;
  readonly applicants: number;
  readonly shortlisted: number;
  readonly offers: number;
  readonly completed: number;
}

/**
 * Shortlisted and offered deliberately OVERLAP, exactly as the Live-drives
 * cards do (`summariseFunnel`): the shortlist is what the recruiter was sent,
 * and an offer does not un-send it. Subtracting one from the other would make
 * the AE's page disagree with the drive it links to.
 */
export function summariseAeDrives(drives: readonly AeDrive[]): AeDriveTotals {
  let applicants = 0;
  let shortlisted = 0;
  let offers = 0;

  for (const drive of drives) {
    applicants += drive.applicants.length;
    for (const applicant of drive.applicants) {
      if (applicant.shortlisted) shortlisted += 1;
      if (applicant.hasOffer) offers += 1;
    }
  }

  return {
    broughtIn: drives.length,
    liveNow: drives.filter((d) => d.status === "live").length,
    applicants,
    shortlisted,
    offers,
    completed: drives.filter((d) => d.status === "completed").length,
  };
}
