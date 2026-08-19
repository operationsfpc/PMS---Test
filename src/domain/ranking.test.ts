import { describe, expect, it } from "vitest";
import { DEFAULT_RANKING_WEIGHTS, type RankingApplicant, rankApplicants } from "./ranking";

/**
 * R11 - the MVP shortlisting provider.
 *
 * Deterministic, weighted and EXPLAINABLE. PRD 13.1 requires every
 * shortlisting decision to be auditable, so each candidate carries the reasons
 * that produced their score. No AI, no hidden model, no cost.
 *
 * The skill-score schema is invented (A12) and pending confirmation (P3), so
 * the weights are parameters rather than constants.
 */
const base: RankingApplicant = {
  applicationId: "app1",
  studentName: "Priya Ramesh",
  overallCgpa: 8,
  currentArrears: 0,
  historyOfArrears: 0,
  skillScores: [],
  preferredRoleCategories: [],
};

const drive = { roleCategory: "software_technical" as const, mandatorySkills: [] as string[] };

describe("rankApplicants", () => {
  it("scores a perfect candidate at 100", () => {
    const [ranked] = rankApplicants(
      [
        {
          ...base,
          overallCgpa: 10,
          skillScores: [{ skill: "TypeScript", score: 5 }],
          preferredRoleCategories: ["software_technical"],
        },
      ],
      { ...drive, mandatorySkills: ["TypeScript"] },
    );

    expect(ranked?.score).toBe(100);
  });

  it("orders by score, highest first", () => {
    const ranked = rankApplicants(
      [
        { ...base, applicationId: "low", overallCgpa: 5 },
        { ...base, applicationId: "high", overallCgpa: 9.5 },
      ],
      drive,
    );

    expect(ranked.map((r) => r.applicationId)).toEqual(["high", "low"]);
  });

  it("breaks ties deterministically, so the same input always ranks the same", () => {
    const ranked = rankApplicants(
      [
        { ...base, applicationId: "b" },
        { ...base, applicationId: "a" },
      ],
      drive,
    );

    expect(ranked.map((r) => r.applicationId)).toEqual(["a", "b"]);
  });

  it("penalises standing arrears harder than cleared ones", () => {
    const [clean, cleared, standing] = rankApplicants(
      [
        { ...base, applicationId: "a-clean" },
        { ...base, applicationId: "b-cleared", historyOfArrears: 2 },
        { ...base, applicationId: "c-standing", currentArrears: 1, historyOfArrears: 2 },
      ],
      drive,
    );

    expect(clean?.score).toBeGreaterThan(cleared?.score ?? 0);
    expect(cleared?.score).toBeGreaterThan(standing?.score ?? 0);
  });

  it("gives full skill marks when the drive demands no particular skill", () => {
    const [ranked] = rankApplicants([{ ...base, overallCgpa: 10 }], {
      roleCategory: null,
      mandatorySkills: [],
    });

    // Nothing to fail on: skills and role preference both score in full.
    expect(ranked?.score).toBe(100);
  });

  it("scores a missing mandatory skill as zero for that skill, not as absent", () => {
    const [ranked] = rankApplicants(
      [{ ...base, skillScores: [{ skill: "TypeScript", score: 5 }] }],
      { ...drive, mandatorySkills: ["TypeScript", "SQL"] },
    );

    const skillReason = ranked?.reasons.find((r) => /skill/i.test(r));
    expect(skillReason).toMatch(/1 of 2/i);
  });

  it("rewards a student who actually wants this kind of role", () => {
    const [wanted, notWanted] = rankApplicants(
      [
        {
          ...base,
          applicationId: "a-wanted",
          preferredRoleCategories: ["software_technical"],
        },
        { ...base, applicationId: "b-other", preferredRoleCategories: ["sales"] },
      ],
      drive,
    );

    expect(wanted?.score).toBeGreaterThan(notWanted?.score ?? 0);
  });

  it("explains every candidate, because a shortlist must be auditable", () => {
    const [ranked] = rankApplicants([base], drive);

    expect(ranked?.reasons.length).toBeGreaterThan(0);
    expect(ranked?.reasons.join(" ")).toMatch(/cgpa/i);
  });

  it("honours re-weighting, so the weights can be tuned without a release", () => {
    const cgpaOnly = { cgpa: 100, skillMatch: 0, arrears: 0, rolePreference: 0 };

    const [ranked] = rankApplicants(
      [{ ...base, overallCgpa: 5, currentArrears: 4 }],
      drive,
      cgpaOnly,
    );

    expect(ranked?.score).toBe(50);
  });

  it("never returns a score outside 0-100", () => {
    const ranked = rankApplicants(
      [
        { ...base, applicationId: "a", overallCgpa: 0, currentArrears: 9 },
        { ...base, applicationId: "b", overallCgpa: 10 },
      ],
      drive,
    );

    for (const candidate of ranked) {
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(100);
    }
  });

  it("returns nothing for no applicants rather than throwing", () => {
    expect(rankApplicants([], drive)).toEqual([]);
  });

  it("ships defaults that add up to 100, so a score reads as a percentage", () => {
    const total =
      DEFAULT_RANKING_WEIGHTS.cgpa +
      DEFAULT_RANKING_WEIGHTS.skillMatch +
      DEFAULT_RANKING_WEIGHTS.arrears +
      DEFAULT_RANKING_WEIGHTS.rolePreference;

    expect(total).toBe(100);
  });
});
