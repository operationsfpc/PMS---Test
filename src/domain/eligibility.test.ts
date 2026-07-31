import { describe, expect, it } from "vitest";
import { type EligibilityCriteria, evaluateEligibility } from "./eligibility";
import type { AcademicProfile } from "./types";

/**
 * R2 — evaluateEligibility. PRD §7.1, §7.2.
 * Evaluated at the instant of application, against verified data only.
 * Must return EVERY failure so the UI can explain fully.
 */

const student: AcademicProfile = {
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  overallCgpa: 8.2,
  tenthPercentage: 91,
  twelfthPercentage: 88,
  currentArrears: 0,
  historyOfArrears: 0,
  city: "Chennai",
  campus: "Alliance University",
};

/** An unconstrained drive: empty list means "any". */
const openCriteria: EligibilityCriteria = {
  eligibleDegrees: [],
  eligibleBranches: [],
  eligiblePassingYears: [],
  minOverallCgpa: null,
  minTenthPercentage: null,
  minTwelfthPercentage: null,
  arrearPolicy: "flexible",
  targetCities: [],
  targetCampuses: [],
};

const codesFor = (
  profile: Partial<AcademicProfile>,
  criteria: Partial<EligibilityCriteria>,
): string[] =>
  evaluateEligibility({ ...student, ...profile }, { ...openCriteria, ...criteria }).failures.map(
    (f) => f.code,
  );

describe("evaluateEligibility", () => {
  it("passes a qualified student against an unconstrained drive", () => {
    const result = evaluateEligibility(student, openCriteria);
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
  });

  describe("empty criteria lists mean 'any', not 'none'", () => {
    it("does not filter on degree when no degrees are listed", () => {
      expect(codesFor({}, { eligibleDegrees: [] })).toEqual([]);
    });
  });

  describe("categorical criteria", () => {
    it("rejects a degree that is not listed", () => {
      expect(codesFor({}, { eligibleDegrees: ["MCA", "M.Sc CS"] })).toEqual(["degree"]);
    });

    it("accepts a degree that is listed", () => {
      expect(codesFor({}, { eligibleDegrees: ["B.E", "MCA"] })).toEqual([]);
    });

    it("rejects a branch that is not listed", () => {
      expect(codesFor({}, { eligibleBranches: ["ECE"] })).toEqual(["branch"]);
    });

    it("rejects a passing year that is not listed", () => {
      expect(codesFor({}, { eligiblePassingYears: [2027] })).toEqual(["passing_year"]);
    });

    it("rejects a city outside the target list", () => {
      expect(codesFor({}, { targetCities: ["Bengaluru"] })).toEqual(["city"]);
    });

    it("rejects a campus outside the target list", () => {
      expect(codesFor({}, { targetCampuses: ["VIT Bangalore"] })).toEqual(["campus"]);
    });
  });

  describe("numeric cutoffs are inclusive", () => {
    it("accepts a CGPA exactly on the cutoff", () => {
      expect(codesFor({ overallCgpa: 7 }, { minOverallCgpa: 7 })).toEqual([]);
    });

    it("rejects a CGPA below the cutoff", () => {
      expect(codesFor({ overallCgpa: 6.99 }, { minOverallCgpa: 7 })).toEqual(["overall_cgpa"]);
    });

    it("uses overall CGPA, never the latest semester", () => {
      // Guards decision Q7. The profile exposes only overallCgpa for this reason.
      expect(codesFor({ overallCgpa: 9 }, { minOverallCgpa: 8.5 })).toEqual([]);
    });

    it("rejects 10th marks below the cutoff", () => {
      expect(codesFor({ tenthPercentage: 59 }, { minTenthPercentage: 60 })).toEqual(["tenth"]);
    });

    it("rejects 12th marks below the cutoff", () => {
      expect(codesFor({ twelfthPercentage: 59 }, { minTwelfthPercentage: 60 })).toEqual([
        "twelfth",
      ]);
    });
  });

  describe("arrear policy", () => {
    it("flexible accepts a student with standing arrears and history", () => {
      expect(
        codesFor({ currentArrears: 3, historyOfArrears: 5 }, { arrearPolicy: "flexible" }),
      ).toEqual([]);
    });

    it("no_standing rejects a student with current arrears", () => {
      expect(
        codesFor({ currentArrears: 1, historyOfArrears: 1 }, { arrearPolicy: "no_standing" }),
      ).toEqual(["current_arrears"]);
    });

    it("no_standing accepts a student who cleared past backlogs", () => {
      expect(
        codesFor({ currentArrears: 0, historyOfArrears: 2 }, { arrearPolicy: "no_standing" }),
      ).toEqual([]);
    });

    it("no_history is stricter: it rejects a student who cleared past backlogs", () => {
      // Decision Q6 — this is the whole point of the distinction.
      expect(
        codesFor({ currentArrears: 0, historyOfArrears: 2 }, { arrearPolicy: "no_history" }),
      ).toEqual(["arrear_history"]);
    });

    it("no_history reports both failures when the student also has standing arrears", () => {
      expect(
        codesFor({ currentArrears: 1, historyOfArrears: 2 }, { arrearPolicy: "no_history" }),
      ).toEqual(["current_arrears", "arrear_history"]);
    });
  });

  describe("reports every failure, not just the first", () => {
    it("collects all violations so the UI can explain fully", () => {
      const result = evaluateEligibility(
        { ...student, overallCgpa: 5, currentArrears: 2, tenthPercentage: 40 },
        {
          ...openCriteria,
          eligibleDegrees: ["MCA"],
          minOverallCgpa: 7,
          minTenthPercentage: 60,
          arrearPolicy: "no_standing",
        },
      );

      expect(result.eligible).toBe(false);
      expect(result.failures.map((f) => f.code)).toEqual([
        "degree",
        "overall_cgpa",
        "tenth",
        "current_arrears",
      ]);
    });

    it("gives each failure a human-readable reason", () => {
      const [failure] = evaluateEligibility(
        { ...student, overallCgpa: 5 },
        { ...openCriteria, minOverallCgpa: 7 },
      ).failures;

      expect(failure?.message).toMatch(/7/);
      expect(failure?.message).toMatch(/5/);
    });
  });
});
