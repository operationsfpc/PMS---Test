/**
 * The registration-to-placement funnel. PRD §17.
 *
 * "Total registered students, through to number of students placed" — the
 * question every stakeholder actually asks, which no single count answers.
 * Each stage says where people are being lost: a roster of 600 with 200
 * submitted forms is a chasing problem, 200 verified out of 590 submitted is a
 * coordinator-capacity problem, and 20 applications from 590 verified students
 * is a targeting problem. They need different responses.
 */

import { percentOf } from "./math";
import type { ParticipationStatus, SrfStatus } from "./types";

export interface FunnelStudent {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly hasApplied: boolean;
  readonly hasOnCampusPlacement: boolean;
}

export interface FunnelStage {
  readonly key: "on_roster" | "submitted" | "verified" | "placed";
  readonly label: string;
  readonly count: number;
  readonly percentOfRoster: number;
}

/** Every status that means the student has sent the form in. */
const SUBMITTED: readonly SrfStatus[] = ["srf_submitted", "srf_approved", "srf_rejected"];

/**
 * The facts a stage is judged on. Narrower than `FunnelStudent`, because the
 * student directory holds these three and not a participation status.
 */
export interface FunnelEvidence {
  readonly srfStatus: SrfStatus;
  readonly hasApplied: boolean;
  readonly hasOnCampusPlacement: boolean;
}

/**
 * The two middle stages, as predicates.
 *
 * Exported 2026-08-26 so the student directory can filter to exactly the
 * population a funnel row counted. Applying and being placed are EVIDENCE: a
 * student who applied was necessarily verified, whatever their status column
 * now says, and a second copy of that reasoning in the directory would drift
 * until the list disagreed with the number that opened it.
 */
export const countsAsSubmitted = (student: FunnelEvidence): boolean =>
  SUBMITTED.includes(student.srfStatus) || student.hasApplied || student.hasOnCampusPlacement;

export const countsAsVerified = (student: FunnelEvidence): boolean =>
  student.srfStatus === "srf_approved" || student.hasApplied || student.hasOnCampusPlacement;

/**
 * The funnel, widest first.
 *
 * Stages are computed CUMULATIVELY, so each one is a superset of the next: a
 * student who is somehow placed without a verified form still counts at every
 * stage above. A funnel that widens as it descends is not a funnel, it is a
 * data bug being read as good news, and it would be read as good news.
 *
 * An opted-out student stays in the stages they genuinely reached. They leave
 * the placement *denominator* (statistics.ts) because they chose not to
 * participate, but they are still on the roster and their form was still
 * verified — dropping them here would make this disagree with the roster count
 * printed beside it.
 *
 * "Applied to a drive" is NOT a stage here (F5, UAT 2026-08-06). Every other
 * stage is a fact about the student and is measured against the roster;
 * applying is a fact about one drive and is measured against that drive's
 * audience. Mixing the two gave a percentage whose denominator was wrong for
 * one of the five rows. It lives in `driveFunnel` instead.
 */
export function registrationFunnel(students: readonly FunnelStudent[]): readonly FunnelStage[] {
  const roster = students.length;

  const placed = students.filter((s) => s.hasOnCampusPlacement).length;

  // Applying is no longer reported, but it is still EVIDENCE: a student who
  // applied was necessarily verified, whatever their status column now says.
  const verified = students.filter(countsAsVerified).length;

  const submitted = students.filter(countsAsSubmitted).length;

  const stages: readonly Omit<FunnelStage, "percentOfRoster">[] = [
    { key: "on_roster", label: "On the roster", count: roster },
    { key: "submitted", label: "Registration form submitted", count: submitted },
    { key: "verified", label: "Verified by a coordinator", count: verified },
    { key: "placed", label: "Placed", count: placed },
  ];

  return stages.map((stage) => ({
    ...stage,
    percentOfRoster: percentOf(stage.count, roster),
  }));
}
