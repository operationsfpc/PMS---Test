import { SKILL_SCORE_MAX } from "./skills";
import type { RoleCategory } from "./types";

export interface SkillScore {
  readonly skill: string;
  /** 0-100. ⚠️ ASSUMPTION — UNCONFIRMED (A12): scale invented, pending P3. */
  readonly score: number;
}

export interface RankingApplicant {
  readonly applicationId: string;
  readonly studentName: string;
  readonly overallCgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly skillScores: readonly SkillScore[];
  readonly preferredRoleCategories: readonly RoleCategory[];
}

export interface RankingDrive {
  readonly roleCategory: RoleCategory | null;
  readonly mandatorySkills: readonly string[];
}

export interface RankingWeights {
  readonly cgpa: number;
  readonly skillMatch: number;
  readonly arrears: number;
  readonly rolePreference: number;
}

export interface RankedApplicant {
  readonly applicationId: string;
  readonly studentName: string;
  readonly score: number;
  /** Why this score. PRD 13.1: a shortlist must be auditable. */
  readonly reasons: readonly string[];
}

/**
 * ⚠️ ASSUMPTION — UNCONFIRMED (A12). Weights are a guess pending P3, which is
 * why they are a parameter: they can be retuned without a release.
 */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  cgpa: 40,
  skillMatch: 30,
  arrears: 15,
  rolePreference: 15,
};

const CGPA_SCALE = 10;

/** Two decimals: enough to separate candidates, no floating-point noise. */
const round2 = (value: number) => Math.round(value * 100) / 100;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * R11 — the MVP shortlisting provider.
 *
 * Deterministic, weighted and explainable, with zero AI cost. Every candidate
 * carries the reasoning that produced their score, which is what PRD 13.1
 * requires of a shortlist.
 *
 * This RANKS. It never rejects: eligibility is R2's job and has already run by
 * the time anyone is ranked. A low score is a low position, not a refusal.
 */
export function rankApplicants(
  applicants: readonly RankingApplicant[],
  drive: RankingDrive,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): readonly RankedApplicant[] {
  const ranked = applicants.map((applicant): RankedApplicant => {
    const reasons: string[] = [];

    // CGPA, as a fraction of the 10-point scale.
    const cgpaFraction = clamp01(applicant.overallCgpa / CGPA_SCALE);
    reasons.push(`CGPA ${applicant.overallCgpa} of ${CGPA_SCALE}.`);

    // Mandatory skills. A skill with no recorded score counts as zero rather
    // than being skipped - "unmeasured" must not read as "excellent".
    let skillFraction = 1;
    if (drive.mandatorySkills.length > 0) {
      const scores = drive.mandatorySkills.map((skill) => {
        const match = applicant.skillScores.find(
          (s) => s.skill.toLowerCase() === skill.toLowerCase(),
        );
        return match === undefined ? 0 : clamp01(match.score / SKILL_SCORE_MAX);
      });

      const met = scores.filter((s) => s > 0).length;
      skillFraction = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      reasons.push(`Scored on ${met} of ${drive.mandatorySkills.length} required skills.`);
    } else {
      reasons.push("No specific skills required for this role.");
    }

    // Arrears. Standing arrears are worse than cleared ones (Q6's spirit).
    let arrearsFraction: number;
    if (applicant.currentArrears > 0) {
      arrearsFraction = 0;
      reasons.push(`${applicant.currentArrears} standing arrear(s).`);
    } else if (applicant.historyOfArrears > 0) {
      arrearsFraction = 0.5;
      reasons.push(`${applicant.historyOfArrears} cleared arrear(s), none standing.`);
    } else {
      arrearsFraction = 1;
      reasons.push("No arrears.");
    }

    // Role preference. A student placed into a role they never asked for is a
    // renege risk, so wanting it counts for something.
    let preferenceFraction: number;
    if (drive.roleCategory === null) {
      preferenceFraction = 1;
      reasons.push("Drive is not restricted to a role category.");
    } else if (applicant.preferredRoleCategories.includes(drive.roleCategory)) {
      preferenceFraction = 1;
      reasons.push("Listed this role category as a preference.");
    } else {
      preferenceFraction = 0;
      reasons.push("Did not list this role category as a preference.");
    }

    const total =
      cgpaFraction * weights.cgpa +
      skillFraction * weights.skillMatch +
      arrearsFraction * weights.arrears +
      preferenceFraction * weights.rolePreference;

    return {
      applicationId: applicant.applicationId,
      studentName: applicant.studentName,
      score: round2(total),
      reasons,
    };
  });

  // Highest first; ties break on applicationId so the same input always
  // produces the same order - a shortlist that reshuffles itself is unusable
  // as evidence.
  return [...ranked].sort((a, b) =>
    b.score === a.score ? a.applicationId.localeCompare(b.applicationId) : b.score - a.score,
  );
}
