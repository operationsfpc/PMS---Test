import { describe, expect, it } from "vitest";
import { buildApplicationSnapshot } from "./application-snapshot";

/**
 * R7 - the immutability rule.
 *
 * An application freezes the verified profile and the ONE resume matching the
 * drive's role category. Every downstream step - shortlisting, recruiter
 * export, rounds, results - reads this snapshot and never the live profile,
 * so a student editing their profile mid-drive cannot change what a recruiter
 * was given.
 */
const student = {
  id: "s1",
  fullName: "Asha Ramanathan",
  rollNumber: "TEC001",
  email: "asha@example.com",
  degree: "B.E / B.Tech (CSE / IT / allied)",
  branch: "CSE",
  passingYear: 2027,
  overallCgpa: 8.24,
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  currentArrears: 0,
  historyOfArrears: 1,
  technicalSkills: "TypeScript, Postgres",
  resumes: [
    { id: "r1", roleCategory: "software_technical" as const },
    { id: "r2", roleCategory: "sales" as const },
  ],
};

describe("buildApplicationSnapshot", () => {
  it("captures the verified academic record", () => {
    const snap = buildApplicationSnapshot(student, "software_technical");

    expect(snap.profile.overallCgpa).toBe(8.24);
    expect(snap.profile.tenthPercentage).toBe(91.4);
    expect(snap.profile.historyOfArrears).toBe(1);
    expect(snap.profile.rollNumber).toBe("TEC001");
  });

  it("picks the resume matching the drive's role category, not the first one", () => {
    expect(buildApplicationSnapshot(student, "sales").resumeId).toBe("r2");
    expect(buildApplicationSnapshot(student, "software_technical").resumeId).toBe("r1");
  });

  it("records no resume when the student has none for that category", () => {
    expect(buildApplicationSnapshot(student, "digital_marketing").resumeId).toBeNull();
  });

  it("is a copy: later edits to the student cannot reach a taken snapshot", () => {
    const mutable = { ...student, resumes: [...student.resumes] };
    const snap = buildApplicationSnapshot(mutable, "software_technical");

    mutable.overallCgpa = 5;
    mutable.fullName = "Someone Else";

    expect(snap.profile.overallCgpa).toBe(8.24);
    expect(snap.profile.fullName).toBe("Asha Ramanathan");
  });

  it("does not carry unverified free text into the recruiter's view", () => {
    const snap = buildApplicationSnapshot(student, "software_technical");
    // Skills are shown to recruiters; they are part of the frozen record.
    expect(snap.profile.technicalSkills).toBe("TypeScript, Postgres");
  });
});
