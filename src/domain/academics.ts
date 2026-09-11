/**
 * Semester-wise academics. Confirmed 2026-08-04, supersedes the single
 * cumulative CGPA the SRF used to collect.
 *
 * A student pursuing UG records one line per semester, up to 10. A student
 * pursuing PG records a single aggregate for their completed UG, then one line
 * per PG semester, up to 4.
 *
 * ELIGIBILITY IS JUDGED ON THE LATEST *VERIFIED* SEMESTER. Students type their
 * own marks, so letting the latest *entered* figure decide whether they may
 * apply would let anyone qualify for anything by typing 10. Verification is
 * what makes a number load-bearing.
 */

import type { SrfStatus } from "./types";

export type ProgrammeLevel = "ug" | "pg";

/** Confirmed: 10 for an undergraduate, 4 for a postgraduate. */
export const MAX_SEMESTERS: Readonly<Record<ProgrammeLevel, number>> = {
  ug: 10,
  pg: 4,
};

const LEVEL_LABEL: Readonly<Record<ProgrammeLevel, string>> = {
  ug: "An undergraduate",
  pg: "A postgraduate",
};

export interface SemesterRecord {
  readonly semesterNumber: number;
  /** CGPA, not GPA: cumulative to the end of this semester, on a 10-point scale. */
  readonly cgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  /** A coordinator has checked this line against the marksheet. */
  readonly verified: boolean;
}

/** What the eligibility rules are actually applied to. */
export interface AcademicStanding {
  readonly cgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
}

export function maxSemestersFor(level: ProgrammeLevel): number {
  return MAX_SEMESTERS[level];
}

/**
 * The most recent semester a coordinator has verified.
 *
 * "Latest" is the highest semester NUMBER, not the most recently entered row:
 * a student correcting semester 2 after entering semester 5 has not moved
 * backwards through their degree.
 */
export function latestVerifiedSemester(
  semesters: readonly SemesterRecord[],
): SemesterRecord | null {
  let latest: SemesterRecord | null = null;

  for (const semester of semesters) {
    if (!semester.verified) continue;
    if (latest === null || semester.semesterNumber > latest.semesterNumber) {
      latest = semester;
    }
  }

  return latest;
}

/**
 * Null rather than a zeroed record when nothing is verified yet.
 *
 * Zero is a real CGPA. Returning it would silently fail every cutoff while
 * looking like an answer; null forces the caller to handle "not yet verified"
 * as the distinct case it is.
 */
export function academicStandingFrom(
  semesters: readonly SemesterRecord[],
): AcademicStanding | null {
  const latest = latestVerifiedSemester(semesters);
  if (latest === null) return null;

  const maxHistory = Math.max(
    latest.historyOfArrears,
    ...semesters.filter((s) => s.verified).map((s) => s.historyOfArrears),
  );

  return {
    cgpa: latest.cgpa,
    currentArrears: latest.currentArrears,
    historyOfArrears: maxHistory,
  };
}

/** Every problem at once — a student fixing one field at a time gives up. */
export function validateSemesters(
  level: ProgrammeLevel,
  semesters: readonly SemesterRecord[],
): readonly string[] {
  const problems: string[] = [];
  const limit = maxSemestersFor(level);

  if (semesters.length > limit) {
    problems.push(`${LEVEL_LABEL[level]} has at most ${limit} semesters.`);
  }

  const seen = new Set<number>();

  for (const semester of semesters) {
    const n = semester.semesterNumber;

    if (n < 1 || n > limit) {
      problems.push(`Semester ${n} is outside the range for this programme.`);
    }
    if (seen.has(n)) {
      problems.push(`Semester ${n} appears more than once.`);
    }
    seen.add(n);

    if (semester.cgpa < 0 || semester.cgpa > 10) {
      problems.push(`Semester ${n}: CGPA is on a 10-point scale.`);
    }
    if (semester.currentArrears < 0 || semester.historyOfArrears < 0) {
      problems.push(`Semester ${n}: arrears cannot be negative.`);
    } else if (semester.historyOfArrears < semester.currentArrears) {
      // History includes cleared backlogs, so it can never be the smaller number.
      problems.push(`Semester ${n}: history of arrears cannot be less than current arrears.`);
    }
  }

  const sortedBySem = [...semesters].sort((a, b) => a.semesterNumber - b.semesterNumber);
  for (let i = 1; i < sortedBySem.length; i++) {
    const prev = sortedBySem[i - 1];
    const curr = sortedBySem[i];
    if (
      curr &&
      prev &&
      curr.historyOfArrears >= 0 &&
      prev.historyOfArrears >= 0 &&
      curr.historyOfArrears < prev.historyOfArrears
    ) {
      problems.push(
        `Semester ${curr.semesterNumber}: history of arrears (${curr.historyOfArrears}) cannot be less than Semester ${prev.semesterNumber} (${prev.historyOfArrears}). Arrear history is cumulative.`,
      );
    }
  }

  return problems;
}

/**
 * Adding a semester AFTER the form has been verified. F13 (UAT 2026-08-06).
 *
 * "students might get subsequent semester results after they have registered
 * to placements. So they must be able to submit marks of subsequent semesters.
 * But this should be visible only after approval from Campus PC."
 *
 * This is deliberately NOT the same permission as editing the form. `srfAccess`
 * locks an approved form for a real reason: §7.2 judges eligibility on VERIFIED
 * data, so a student changing a checked figure silently invalidates every
 * shortlist it has already been measured for. ADDING the next semester takes
 * nothing away from the coordinator - the new line arrives `pending`, and
 * `academicStandingFrom` counts only verified rows, so it changes no
 * eligibility until someone has compared it to a marksheet.
 */
export type SemesterAdditionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface SemesterAdditionContext {
  readonly srfStatus: SrfStatus;
  readonly programmeLevel: ProgrammeLevel;
  readonly declaredSemesters: readonly number[];
  readonly semesterNumber: number;
}

/**
 * The one semester a student may add next, or null when there is none.
 *
 * Counted from the HIGHEST declared rather than from how many there are: a
 * record of semesters 1 and 3 is a gap somebody has to explain, and offering
 * to add semester 3 again would not be the way to explain it.
 */
export function nextSemesterFor(context: {
  readonly programmeLevel: ProgrammeLevel;
  readonly declaredSemesters: readonly number[];
}): number | null {
  const highest = context.declaredSemesters.reduce((max, n) => Math.max(max, n), 0);
  const next = highest + 1;

  return next > maxSemestersFor(context.programmeLevel) ? null : next;
}

/**
 * Every semester the student could still add, in the order results arrive.
 *
 * Asked for 2026-08-06: "while adding additional semester marks, have option
 * to upload for multiple additional semesters. up to total of 10 for UG and up
 * to total of 4 for PG." A student who registered in their third year and
 * comes back with two more results had to add one, wait for it to land, and
 * start again.
 *
 * The ceiling is a TOTAL, not an allowance per visit: what is already on the
 * record counts against it, which is why this is derived from
 * `declaredSemesters` rather than from a number the screen keeps.
 */
export function addableSemesters(context: {
  readonly programmeLevel: ProgrammeLevel;
  readonly declaredSemesters: readonly number[];
}): readonly number[] {
  const next = nextSemesterFor(context);
  if (next === null) return [];

  const limit = maxSemestersFor(context.programmeLevel);
  const remaining: number[] = [];
  for (let n = next; n <= limit; n += 1) remaining.push(n);

  return remaining;
}

export function canAddLaterSemester(context: SemesterAdditionContext): SemesterAdditionDecision {
  if (context.srfStatus !== "srf_approved") {
    return {
      allowed: false,
      reason:
        "You can add later semesters once your registration form has been verified. Until then, add them to the form itself.",
    };
  }

  if (context.declaredSemesters.includes(context.semesterNumber)) {
    return {
      allowed: false,
      reason: `Semester ${context.semesterNumber} is already on your record. Ask your coordinator to correct it.`,
    };
  }

  const next = nextSemesterFor(context);

  if (next === null) {
    return {
      allowed: false,
      reason: `${LEVEL_LABEL[context.programmeLevel]} has at most ${maxSemestersFor(
        context.programmeLevel,
      )} semesters.`,
    };
  }

  // Results arrive in order. Semester 7 landing before 6 means one of the two
  // is wrong, and guessing which would put an unchecked figure on the record.
  if (context.semesterNumber !== next) {
    return {
      allowed: false,
      reason: `Add semester ${next} next. Results are recorded in order.`,
    };
  }

  return { allowed: true };
}

/**
 * The coordinator's decision on one declared semester (2026-08-24 UAT).
 *
 * Mirrors `decideCertificate`: a declared CGPA is a claim until the
 * coordinator has opened the marksheet beside it and agreed. Semesters
 * declared on the registration form are decided wholesale by SRF approval
 * (0031); this rule covers every semester added AFTER — which previously sat
 * `pending` forever, with no queue anywhere.
 */
export type SemesterDecision =
  | { readonly decision: "verify" }
  | { readonly decision: "reject"; readonly reason: string };

export type SemesterDecisionResult =
  | { readonly ok: true; readonly next: "verified" | "rejected" }
  | { readonly ok: false; readonly error: string };

export function decideSemester(
  current: "pending" | "verified" | "rejected",
  decision: SemesterDecision,
): SemesterDecisionResult {
  if (current !== "pending") {
    return { ok: false, error: "This semester has already been decided." };
  }

  if (decision.decision === "reject" && decision.reason.trim() === "") {
    return {
      ok: false,
      error: "A rejection needs a reason, so the student knows what to correct.",
    };
  }

  return { ok: true, next: decision.decision === "verify" ? "verified" : "rejected" };
}
