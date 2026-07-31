/**
 * R2 — Eligibility evaluation. PRD §7.1, §7.2, §22.5.
 *
 * Evaluated at the instant the student applies, against VERIFIED data only.
 * Returns every failure rather than short-circuiting, because the UI must be
 * able to tell a student exactly why they cannot apply.
 */

import type { AcademicProfile, ArrearPolicy } from "./types";

export type EligibilityFailureCode =
  | "degree"
  | "branch"
  | "passing_year"
  | "city"
  | "campus"
  | "overall_cgpa"
  | "tenth"
  | "twelfth"
  | "current_arrears"
  | "arrear_history";

export interface EligibilityFailure {
  readonly code: EligibilityFailureCode;
  readonly message: string;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly failures: readonly EligibilityFailure[];
}

/** An empty list always means "any", never "none". */
export interface EligibilityCriteria {
  readonly eligibleDegrees: readonly string[];
  readonly eligibleBranches: readonly string[];
  readonly eligiblePassingYears: readonly number[];
  /** Tested against overall CGPA, never the latest semester (decision Q7). */
  readonly minOverallCgpa: number | null;
  readonly minTenthPercentage: number | null;
  readonly minTwelfthPercentage: number | null;
  readonly arrearPolicy: ArrearPolicy;
  readonly targetCities: readonly string[];
  readonly targetCampuses: readonly string[];
}

export function evaluateEligibility(
  profile: AcademicProfile,
  criteria: EligibilityCriteria,
): EligibilityResult {
  const failures: EligibilityFailure[] = [];

  const requireMembership = <T>(
    allowed: readonly T[],
    actual: T,
    code: EligibilityFailureCode,
    label: string,
  ): void => {
    if (allowed.length > 0 && !allowed.includes(actual)) {
      failures.push({
        code,
        message: `${label} "${String(actual)}" is not eligible. Allowed: ${allowed.join(", ")}.`,
      });
    }
  };

  const requireMinimum = (
    minimum: number | null,
    actual: number,
    code: EligibilityFailureCode,
    label: string,
  ): void => {
    if (minimum !== null && actual < minimum) {
      failures.push({
        code,
        message: `${label} is ${actual}, below the required minimum of ${minimum}.`,
      });
    }
  };

  requireMembership(criteria.eligibleDegrees, profile.degree, "degree", "Degree");
  requireMembership(criteria.eligibleBranches, profile.branch, "branch", "Branch");
  requireMembership(
    criteria.eligiblePassingYears,
    profile.passingYear,
    "passing_year",
    "Passing year",
  );

  requireMinimum(criteria.minOverallCgpa, profile.overallCgpa, "overall_cgpa", "Overall CGPA");
  requireMinimum(criteria.minTenthPercentage, profile.tenthPercentage, "tenth", "10th percentage");
  requireMinimum(
    criteria.minTwelfthPercentage,
    profile.twelfthPercentage,
    "twelfth",
    "12th percentage",
  );

  // `no_history` is strictly stronger than `no_standing`: it forbids cleared
  // backlogs as well as live ones (decision Q6).
  const forbidsStanding: Record<ArrearPolicy, boolean> = {
    no_standing: true,
    no_history: true,
    flexible: false,
  };

  if (forbidsStanding[criteria.arrearPolicy] && profile.currentArrears > 0) {
    failures.push({
      code: "current_arrears",
      message: `Student has ${profile.currentArrears} standing arrear(s); this drive requires none.`,
    });
  }

  if (criteria.arrearPolicy === "no_history" && profile.historyOfArrears > 0) {
    failures.push({
      code: "arrear_history",
      message:
        `Student has a history of ${profile.historyOfArrears} arrear(s); ` +
        "this drive requires no arrear history at all.",
    });
  }

  requireMembership(criteria.targetCities, profile.city, "city", "City");
  requireMembership(criteria.targetCampuses, profile.campus, "campus", "Campus");

  return { eligible: failures.length === 0, failures };
}
