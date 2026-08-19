import { describe, expect, it } from "vitest";
import {
  applicationEvidenceProblems,
  buildApplicationSnapshot,
  type SnapshotStudent,
} from "./application-snapshot";

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

/**
 * F14 (UAT 2026-08-06): "Ask for a drive specific resume to be uploaded at the
 * time of applying."
 *
 * The per-category resume from the SRF is generic and often months old. A
 * recruiter reads what arrives with the application, so what arrives with the
 * application is what the student chose for THIS drive.
 */
describe("applicationEvidenceProblems", () => {
  it("refuses an application with no resume anywhere", () => {
    const problems = applicationEvidenceProblems({
      hasDriveResume: false,
      hasProfileResume: false,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/resume/i);
  });

  it("accepts one that carries a resume chosen for this drive", () => {
    expect(applicationEvidenceProblems({ hasDriveResume: true, hasProfileResume: false })).toEqual(
      [],
    );
  });

  /**
   * D2 (UAT 2026-08-19): "a student's preferred resume … should auto-populate
   * when they apply." The per-area resume on file is a real resume — the
   * drive-specific upload is the OVERRIDE, not the entry fee. This deliberately
   * softens F14's "must upload per drive", which the client asked for and has
   * now asked to relax.
   */
  it("accepts one that falls back to the saved per-area resume (D2)", () => {
    expect(applicationEvidenceProblems({ hasDriveResume: false, hasProfileResume: true })).toEqual(
      [],
    );
  });
});

/**
 * The snapshot must carry the resume the student attached, not the generic one
 * on file — otherwise asking for it changes nothing about what the recruiter
 * reads.
 */
describe("buildApplicationSnapshot — the drive's own resume", () => {
  const student: SnapshotStudent = {
    id: "s1",
    fullName: "Priya Ramesh",
    rollNumber: "21CSE1042",
    email: "priya@gmail.com",
    degree: "B.E",
    branch: "CSE",
    passingYear: 2026,
    overallCgpa: 8.2,
    tenthPercentage: 92,
    twelfthPercentage: 88,
    currentArrears: 0,
    historyOfArrears: 0,
    technicalSkills: "TypeScript",
    resumes: [{ id: "generic", roleCategory: "software_technical" }],
  };

  it("prefers the resume uploaded for this drive over the one on file", () => {
    const snapshot = buildApplicationSnapshot(student, "software_technical", "for-this-drive");

    expect(snapshot.resumeId).toBe("for-this-drive");
  });

  it("falls back to the role-category resume when no drive resume was given", () => {
    expect(buildApplicationSnapshot(student, "software_technical").resumeId).toBe("generic");
  });
});
