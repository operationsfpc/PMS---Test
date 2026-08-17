/**
 * The placement overview's headline numbers.
 *
 * Respecified 2026-08-17 (Karthik): two rows of boxes. Students registered and
 * eligible, then unique students placed and total placement offers, then the
 * same pair again for internships; and below that, drives completed and in
 * progress, counted separately for placements and internships.
 *
 * THE RULE THAT TIES IT TOGETHER: "Internship convertible to placement is
 * treated as placement." A convertible internship counts in the placement
 * columns and never in the internship ones - the same definition the offer
 * ladder already uses, so the dashboard and the eligibility rules cannot
 * disagree about what a placement is.
 */

import type { ProgrammeLevel } from "./academics";
import type { DriveStatus, DriveType, OfferSource, SrfStatus } from "./types";

export interface MetricStudent {
  readonly studentId: string;
  readonly programmeLevel: ProgrammeLevel;
  readonly srfStatus: SrfStatus;
  readonly tenthPercentage: number | null;
  readonly twelfthPercentage: number | null;
  /** The CURRENT programme. For a PG student this is the post-graduation figure. */
  readonly overallCgpa: number | null;
  /** A PG student's completed undergraduate degree. Null for undergraduates. */
  readonly ugAggregateCgpa: number | null;
}

export interface MetricOffer {
  readonly studentId: string;
  readonly driveType: DriveType;
  readonly source: OfferSource;
}

export interface MetricDrive {
  readonly driveId: string;
  readonly driveType: DriveType;
  readonly status: DriveStatus;
}

export interface StudentMetrics {
  readonly registered: number;
  readonly eligible: number;
  readonly placedStudents: number;
  readonly placementOffers: number;
  readonly internStudents: number;
  readonly internshipOffers: number;
}

export interface DriveMetrics {
  readonly placementCompleted: number;
  readonly placementInProgress: number;
  readonly internshipCompleted: number;
  readonly internshipInProgress: number;
}

/** Drive types that count as a placement. Convertible internships are placements. */
const PLACEMENT_TYPES: readonly DriveType[] = ["placement", "internship_convertible"];

const isPlacementType = (type: DriveType) => PLACEMENT_TYPES.includes(type);

/** Every SRF status that means the form has actually been sent in. */
const SUBMITTED: readonly SrfStatus[] = ["srf_submitted", "srf_approved", "srf_rejected"];

/**
 * The percentage bar, and the CGPA that stands in for it.
 *
 * ⚠️ ASSUMPTION — UNCONFIRMED (A34): that "60%" in a degree means a CGPA of
 * 6.0 on the 10-point scale the form collects. Colleges convert differently -
 * some multiply by 9.5, some publish their own table - so this is the one
 * number in the module that may need changing. It is a named constant for
 * exactly that reason: one edit, and every box follows.
 */
const PERCENTAGE_BAR = 60;
const CGPA_BAR = 6;

/** A mark that was never declared is not evidence of clearing the bar. */
const clears = (value: number | null, bar: number): boolean => value !== null && value >= bar;

/**
 * Does this student clear 60% everywhere it applies?
 *
 * "60% in 10th, 12th and graduation - post graduation as well if applicable."
 *
 * For an undergraduate, "graduation" is the programme they are in, which is
 * `overallCgpa`. For a postgraduate, `overallCgpa` is the POST-graduation
 * figure and their graduation is the UG aggregate they declared on the form -
 * so a PG student has four marks to clear and an undergraduate has three.
 *
 * A missing mark fails. Reading an unfilled form as a pass is how a cohort of
 * 600 reports 600 eligible students on the day the roster is imported.
 */
export function meetsSixtyPercentBar(student: MetricStudent): boolean {
  if (!clears(student.tenthPercentage, PERCENTAGE_BAR)) return false;
  if (!clears(student.twelfthPercentage, PERCENTAGE_BAR)) return false;
  if (!clears(student.overallCgpa, CGPA_BAR)) return false;

  // Only a postgraduate has a prior degree to be held to.
  if (student.programmeLevel === "pg") {
    return clears(student.ugAggregateCgpa, CGPA_BAR);
  }

  return true;
}

/**
 * Row 1.
 *
 * `placedStudents` and `placementOffers` answer different questions on
 * purpose: one student holding three offers is 1 placed and 3 offers.
 * Publishing only one of them is how a placement rate and an offer count come
 * to contradict each other in the same deck.
 *
 * Self-placed offers are excluded from both. They are the student's own find
 * and PRD §16.2 reports them on their own line.
 */
export function summariseStudentMetrics(
  students: readonly MetricStudent[],
  offers: readonly MetricOffer[],
): StudentMetrics {
  const onCampus = offers.filter((o) => o.source === "on_campus");

  const placements = onCampus.filter((o) => isPlacementType(o.driveType));
  const internships = onCampus.filter((o) => o.driveType === "internship");

  return {
    registered: students.filter((s) => SUBMITTED.includes(s.srfStatus)).length,
    eligible: students.filter(meetsSixtyPercentBar).length,
    placedStudents: new Set(placements.map((o) => o.studentId)).size,
    placementOffers: placements.length,
    internStudents: new Set(internships.map((o) => o.studentId)).size,
    internshipOffers: internships.length,
  };
}

/** Out for applications or part-way through its rounds — visible to the cohort. */
const IN_PROGRESS: readonly DriveStatus[] = ["live", "applications_closed", "in_rounds"];

/**
 * Row 2.
 *
 * A drive nobody has published is not "in progress": it is not something the
 * cohort can see. Counting drafts would let the number climb without a single
 * student being told about anything, and `rejected` is not a stage of a
 * journey - it is the journey ending.
 */
export function summariseDriveMetrics(drives: readonly MetricDrive[]): DriveMetrics {
  const count = (type: (t: DriveType) => boolean, statuses: readonly DriveStatus[]) =>
    drives.filter((d) => type(d.driveType) && statuses.includes(d.status)).length;

  const isInternship = (t: DriveType) => t === "internship";

  return {
    placementCompleted: count(isPlacementType, ["completed"]),
    placementInProgress: count(isPlacementType, IN_PROGRESS),
    internshipCompleted: count(isInternship, ["completed"]),
    internshipInProgress: count(isInternship, IN_PROGRESS),
  };
}
