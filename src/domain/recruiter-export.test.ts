import { describe, expect, it } from "vitest";
import { buildRecruiterExport, EXPORT_COLUMNS } from "./recruiter-export";

/**
 * The recruiter export (PRD §14).
 *
 * Built from application SNAPSHOTS, never live profiles (R7). A student who
 * edits their CGPA after applying, or a coordinator correcting a verified
 * figure mid-drive, must not silently change what a recruiter was already
 * given - the export has to match the file sent last week.
 *
 * Every export is a data-sharing event and is audit-logged elsewhere; this
 * function only decides what leaves the building.
 */
const shortlisted = [
  {
    applicationId: "a1",
    included: true,
    snapshot: {
      profile: {
        id: "s1",
        fullName: "Asha Ramanathan",
        rollNumber: "TEC001",
        email: "asha@example.com",
        degree: "B.E",
        branch: "CSE",
        passingYear: 2027,
        overallCgpa: 8.24,
        tenthPercentage: 91.4,
        twelfthPercentage: 88,
        currentArrears: 0,
        historyOfArrears: 1,
        technicalSkills: "TypeScript",
      },
      resumeId: "r1",
    },
  },
  {
    applicationId: "a2",
    included: false,
    snapshot: {
      profile: {
        id: "s2",
        fullName: "Not Shortlisted",
        rollNumber: "TEC002",
        email: "nope@example.com",
        degree: "B.E",
        branch: "CSE",
        passingYear: 2027,
        overallCgpa: 6,
        tenthPercentage: 70,
        twelfthPercentage: 70,
        currentArrears: 2,
        historyOfArrears: 2,
        technicalSkills: "",
      },
      resumeId: null,
    },
  },
];

describe("buildRecruiterExport", () => {
  it("exports only the shortlisted", () => {
    const result = buildRecruiterExport(shortlisted);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.["Roll number"]).toBe("TEC001");
  });

  it("never leaks a student who was not put forward", () => {
    const result = buildRecruiterExport(shortlisted);
    expect(JSON.stringify(result.rows)).not.toContain("Not Shortlisted");
  });

  it("reads the snapshot, so a later profile edit cannot change a sent export", () => {
    const copy = structuredClone(shortlisted);
    const result = buildRecruiterExport(copy);

    // Simulate the live profile changing after the application was taken.
    const first = copy[0];
    if (first !== undefined) first.snapshot.profile.overallCgpa = 4.0;

    expect(result.rows[0]?.["Overall CGPA"]).toBe(8.24);
  });

  it("uses stable, human column headings", () => {
    const result = buildRecruiterExport(shortlisted);
    expect(Object.keys(result.rows[0] ?? {})).toEqual([...EXPORT_COLUMNS]);
  });

  it("lists the resumes to bundle, and only for exported candidates", () => {
    const result = buildRecruiterExport(shortlisted);
    expect(result.resumeIds).toEqual(["r1"]);
  });

  it("flags a shortlisted candidate with no resume rather than dropping them", () => {
    const [first] = shortlisted;
    if (first === undefined) throw new Error("fixture missing");
    const noResume = [{ ...first, snapshot: { ...first.snapshot, resumeId: null } }];
    const result = buildRecruiterExport(noResume);

    expect(result.rows).toHaveLength(1);
    expect(result.missingResumes).toEqual(["TEC001"]);
    expect(result.resumeIds).toEqual([]);
  });

  it("exports nothing when nobody was shortlisted", () => {
    const result = buildRecruiterExport([]);
    expect(result.rows).toEqual([]);
    expect(result.resumeIds).toEqual([]);
  });
});
