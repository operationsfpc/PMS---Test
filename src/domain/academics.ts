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

  return {
    cgpa: latest.cgpa,
    currentArrears: latest.currentArrears,
    historyOfArrears: latest.historyOfArrears,
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

  return problems;
}
