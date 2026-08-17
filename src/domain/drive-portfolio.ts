/**
 * A drive seen by the people who own it.
 *
 * Requested 2026-08-04: the Account Executive who raised a drive and the
 * Delivery Head who approved it should be able to see "all drives they have
 * raised/approved, the applicants to the drive, the progress of the drives".
 *
 * All three questions are answered here rather than on their screens, and the
 * applicant's stage is decided by the same `applicationProgress` the student
 * sees on their own dashboard. Two screens describing one applicant must never
 * be able to disagree.
 */

import { type ApplicantRound, applicationProgress } from "./student-progress";
import type { AppRole, DriveStatus } from "./types";

/**
 * Who may shortlist from the drive portfolio. F15 (UAT 2026-08-06).
 *
 * The same screen now serves the AE, the Delivery Head and the Central CPC -
 * "must be the present for Central Placement Coordinator WITH SHORTLISTING
 * ACCESS". Only one of them may act on it.
 *
 * Shortlisting decides which students a recruiter ever sees (PRD 13.1), so it
 * belongs to the coordinators. The AE is the recruiter's own contact and the
 * Delivery Head approved the commercials; neither should be choosing
 * candidates, however convenient the button would be.
 */
export function canShortlistFromPortfolio(role: AppRole): boolean {
  return role === "central_placement_coordinator" || role === "campus_placement_coordinator";
}

/**
 * Who may publish a drive. 2026-08-17 (Karthik).
 *
 * "The AE should only be able to view the students shortlisted or selected or
 * their drive status and results. They should not be able to publish drives or
 * shortlist students."
 *
 * Publishing is the act that makes a drive visible to students and opens the
 * application window (PRD §12). It is deliberately NOT the same person who
 * raised the PIF: the AE speaks for the recruiter, and the separation between
 * "the client asked for this" and "our students were told about it" is the
 * whole point of the Central CPC sitting in the middle.
 *
 * The Delivery Head approves the commercials and is excluded for the same
 * reason — approval is not announcement.
 */
export function canPublishDrive(role: AppRole): boolean {
  return role === "central_placement_coordinator";
}

/**
 * The drive lifecycle: three verbs, three roles, no overlaps.
 * 2026-08-17 (Karthik), "to keep drives simple".
 *
 *     raise -> AE          approve -> Delivery Head      publish -> Central CPC
 *
 * The separation IS the control. If one role held two of these, a drive could
 * travel from an idea to in front of students without a second person having
 * looked at it - and the commercial terms the AE agreed with the recruiter are
 * exactly what the Delivery Head exists to check.
 *
 * Admin is deliberately given none of them. Admin sets up the organisation;
 * being able to fix anything is not a reason to be able to do everything, and
 * an Admin who could raise and approve their own drive would be the whole
 * separation defeated by one account.
 */
export function canRaiseDrive(role: AppRole): boolean {
  return role === "account_executive";
}

/** Approving is the Delivery Head's alone — and they may not raise one to approve. */
export function canApproveDrive(role: AppRole): boolean {
  return role === "delivery_head";
}

/**
 * Who may see the company-facing applicant list on the drive portfolio.
 * 2026-08-17 (Karthik).
 *
 * "For drives with a status of Published or Approved, viewing company
 * applicants is strictly restricted to the Account Executive. Central
 * Placement Coordinators and other non-Account Executive roles cannot view or
 * access the applicants list for these drives."
 *
 * The request was framed by status - approved and published - but the answer
 * does not vary by status, so this does not pretend to consult one. Before
 * approval a drive has no applicants to list, so restricting every status is
 * the same rule stated without a branch that could never be false. The moment
 * that stops being true, this signature grows a status and the test says why.
 *
 * This is NOT the coordinators' working list. Shortlisting, Rounds & results,
 * Final selection and the campus Drive progress screen are untouched - they
 * are how a coordinator reaches applicants, and they carry their own rules.
 */
export function canViewDriveApplicants(role: AppRole): boolean {
  return role === "account_executive";
}

export type DriveRole = "raised" | "approved" | "published";

export interface DriveOwnership {
  readonly createdBy: string | null;
  readonly approvedBy: string | null;
  readonly publishedBy: string | null;
}

/**
 * Which hats this person wore on this drive.
 *
 * A list rather than a single answer: one person can raise a drive and publish
 * it, and a screen that had to pick one would have to pick wrongly. Order is
 * pipeline order, so the labels read in the sequence the work happened.
 */
export function involvementIn(drive: DriveOwnership, profileId: string): readonly DriveRole[] {
  const roles: DriveRole[] = [];
  if (drive.createdBy === profileId) roles.push("raised");
  if (drive.approvedBy === profileId) roles.push("approved");
  if (drive.publishedBy === profileId) roles.push("published");
  return roles;
}

/**
 * The lifecycle as a pipeline, in the order a drive actually travels it.
 *
 * `rejected` is deliberately absent: it is not a point on the journey, it is
 * the journey ending. Typing the phases as a Record over "every status except
 * rejected" means a new drive status cannot be added without deciding where on
 * the pipeline it sits - the compiler asks.
 */
const PIPELINE: readonly Exclude<DriveStatus, "rejected">[] = [
  "draft",
  "submitted",
  "approved",
  "live",
  "applications_closed",
  "in_rounds",
  "completed",
];

const PHASE: Readonly<Record<Exclude<DriveStatus, "rejected">, string>> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved — not yet published",
  live: "Applications open",
  applications_closed: "Applications closed",
  in_rounds: "Rounds in progress",
  completed: "Completed",
};

export interface DriveProgressFacts {
  readonly status: DriveStatus;
  readonly onHold: boolean;
  readonly totalRounds: number;
  /** Rounds where at least one result has been declared. */
  readonly roundsDecided: number;
}

export interface DriveProgress {
  readonly phase: string;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly percentComplete: number;
  readonly roundsDecided: number;
  readonly totalRounds: number;
  /** Nothing more will happen to this drive without someone intervening. */
  readonly terminal: boolean;
  /** Why the drive cannot move, in words, or null. */
  readonly blocked: string | null;
}

/**
 * How far along a drive is.
 *
 * Position on the pipeline, not a weighted guess: every stage is worth the
 * same, because inventing weights would make the number look precise while
 * meaning nothing. A rejected drive is taken OFF the pipeline entirely - it
 * never travels further, and showing it as 14% done would imply it might.
 *
 * `onHold` is reported alongside the stage rather than replacing it, because
 * that is what it is: a flag that composes with the lifecycle (§3.2).
 */
export function driveProgress(facts: DriveProgressFacts): DriveProgress {
  const stageCount = PIPELINE.length;
  const blocked = facts.onHold ? "On hold — it cannot be published until the hold is lifted" : null;
  const rounds = { roundsDecided: facts.roundsDecided, totalRounds: facts.totalRounds };

  if (facts.status === "rejected") {
    return {
      ...rounds,
      phase: "Rejected",
      stageIndex: 0,
      stageCount,
      percentComplete: 0,
      terminal: true,
      blocked,
    };
  }

  const stageIndex = PIPELINE.indexOf(facts.status);

  return {
    ...rounds,
    phase: PHASE[facts.status],
    stageIndex,
    stageCount,
    percentComplete: Math.round((stageIndex / (stageCount - 1)) * 100),
    terminal: facts.status === "completed",
    blocked,
  };
}

export interface ApplicantFacts {
  readonly applicationId: string;
  /** A coordinator included them in the list sent to the recruiter. */
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
  readonly rounds: readonly ApplicantRound[];
}

export interface DriveFunnel {
  readonly applied: number;
  readonly shortlisted: number;
  readonly inRounds: number;
  readonly offers: number;
  readonly notSelected: number;
}

/**
 * The funnel, counted from the same stages the applicants themselves are shown.
 *
 * "In rounds" therefore means what it means everywhere else: a round has named
 * this applicant. Applying is not being in a round - round 1 is the
 * recruiter's choice from the exported list (Q9), and counting applicants as
 * participants would tell an AE that 300 people are sitting an interview.
 */
export function summariseFunnel(applicants: readonly ApplicantFacts[]): DriveFunnel {
  let shortlisted = 0;
  let inRounds = 0;
  let offers = 0;
  let notSelected = 0;

  for (const applicant of applicants) {
    if (applicant.shortlisted) shortlisted += 1;

    const { stage } = applicationProgress({
      rounds: applicant.rounds,
      hasOffer: applicant.hasOffer,
    });

    if (stage === "in_process") inRounds += 1;
    if (stage === "selected") offers += 1;
    if (stage === "not_selected") notSelected += 1;
  }

  return { applied: applicants.length, shortlisted, inRounds, offers, notSelected };
}

/** The least a drive must have for somebody to search for it by name. */
export interface SearchableDrive {
  readonly companyName: string;
  readonly roleTitle: string;
}

/**
 * The drives matching what was typed into the search box (2026-08-18: "add a
 * search button for the drive in progress/live drives page").
 *
 * A domain predicate rather than an inline `filter`, because the same words
 * must match the same drives on every screen that lists them: a coordinator who
 * searches "hcl" and is shown nothing concludes the drive is gone.
 *
 * EVERY term must match, so typing another word narrows the list. Matching any
 * term would widen it, which is the opposite of what somebody adding a word is
 * asking for. Both the company and the role are searched — two drives at one
 * company differ only by the role.
 */
export function searchDrives<TDrive extends SearchableDrive>(
  drives: readonly TDrive[],
  query: string,
): readonly TDrive[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return drives;

  return drives.filter((drive) => {
    const haystack = `${drive.companyName} ${drive.roleTitle}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
