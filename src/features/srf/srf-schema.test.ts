import { describe, expect, it } from "vitest";
import { SRF_DEFAULTS, type SrfFormValues, srfSchema } from "./srf-schema";

const valid: SrfFormValues = {
  ...SRF_DEFAULTS,
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  mobile: "9876543210",
  // Mandatory since 2026-08-04.
  alternateContact: "9876500000",
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  programmeLevel: "ug",
  semesters: [
    { semesterNumber: 1, cgpa: 8.1, currentArrears: 0, historyOfArrears: 0 },
    { semesterNumber: 2, cgpa: 8.24, currentArrears: 0, historyOfArrears: 0 },
  ],
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
};

const errorsFor = (patch: Partial<SrfFormValues>): Record<string, string> => {
  const result = srfSchema.safeParse({ ...valid, ...patch });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("srfSchema", () => {
  it("accepts a complete, valid form", () => {
    expect(srfSchema.safeParse(valid).success).toBe(true);
  });

  it("requires consent before submission (PRD §4.1)", () => {
    expect(errorsFor({ consent: false as unknown as true }).consent).toMatch(/must consent/i);
  });

  it("requires at least one role category", () => {
    expect(errorsFor({ roleCategories: [], resumeCategories: [] }).roleCategories).toMatch(
      /at least one/i,
    );
  });

  it("requires a resume for every selected role category", () => {
    const errors = errorsFor({
      roleCategories: ["software_technical", "sales"],
      resumeCategories: ["software_technical"],
    });
    expect(errors.resumeCategories).toMatch(/resume for every role category/i);
  });

  // Arrears and CGPA moved onto the semester lines on 2026-08-04. The rules
  // did not go away - they are asserted per-semester in "semester-wise
  // academics" below, and exhaustively in src/domain/academics.test.ts.

  it("accepts cleared backlogs — history above current", () => {
    expect(
      errorsFor({
        semesters: [{ semesterNumber: 1, cgpa: 8, currentArrears: 0, historyOfArrears: 4 }],
      }),
    ).toEqual({});
  });

  it("rejects marks above 100", () => {
    expect(errorsFor({ tenthPercentage: 105 }).tenthPercentage).toMatch(/between 0 and 100/i);
  });

  /**
   * Semester-wise academics, confirmed 2026-08-04. The single cumulative CGPA
   * this form used to collect is gone; the rules live in src/domain/academics.
   */
  describe("semester-wise academics", () => {
    it("accepts an undergraduate with semester lines", () => {
      expect(errorsFor({})).toEqual({});
    });

    it("needs at least one semester", () => {
      expect(errorsFor({ semesters: [] }).semesters).toMatch(/at least one semester/i);
    });

    it("refuses an eleventh undergraduate semester", () => {
      const eleven = Array.from({ length: 11 }, (_, i) => ({
        semesterNumber: i + 1,
        cgpa: 8,
        currentArrears: 0,
        historyOfArrears: 0,
      }));
      expect(errorsFor({ semesters: eleven }).semesters).toMatch(/at most 10 semesters/i);
    });

    it("refuses a fifth postgraduate semester", () => {
      const five = Array.from({ length: 5 }, (_, i) => ({
        semesterNumber: i + 1,
        cgpa: 8,
        currentArrears: 0,
        historyOfArrears: 0,
      }));
      expect(
        errorsFor({ programmeLevel: "pg", ugAggregateCgpa: 7.4, semesters: five }).semesters,
      ).toMatch(/at most 4 semesters/i);
    });

    it("refuses a CGPA off the 10-point scale, because it is a CGPA not a GPA", () => {
      expect(
        errorsFor({
          semesters: [{ semesterNumber: 1, cgpa: 78, currentArrears: 0, historyOfArrears: 0 }],
        }).semesters,
      ).toMatch(/10-point scale/i);
    });

    it("refuses a history of arrears below the standing count", () => {
      expect(
        errorsFor({
          semesters: [{ semesterNumber: 1, cgpa: 8, currentArrears: 3, historyOfArrears: 1 }],
        }).semesters,
      ).toMatch(/history of arrears/i);
    });

    it("requires a postgraduate to give their completed UG result", () => {
      expect(errorsFor({ programmeLevel: "pg", ugAggregateCgpa: null }).ugAggregateCgpa).toMatch(
        /undergraduate/i,
      );
    });

    it("does not ask an undergraduate for one", () => {
      expect(errorsFor({ programmeLevel: "ug", ugAggregateCgpa: null })).toEqual({});
    });
  });

  it("rejects a malformed mobile number", () => {
    expect(errorsFor({ mobile: "12345" }).mobile).toMatch(/10-digit/i);
  });

  it("allows WhatsApp to be blank", () => {
    expect(errorsFor({ whatsapp: "" })).toEqual({});
  });

  it("rejects a malformed optional number when one is supplied", () => {
    expect(errorsFor({ whatsapp: "123" }).whatsapp).toMatch(/10-digit/i);
  });

  /**
   * Requested 2026-08-04. A drive-day no-show that cannot be reached costs the
   * student the opportunity and the college the recruiter, so a second number
   * is not optional.
   */
  it("requires an alternate contact number", () => {
    expect(errorsFor({ alternateContact: "" }).alternateContact).toMatch(/required|10-digit/i);
  });

  it("still rejects a malformed alternate number", () => {
    expect(errorsFor({ alternateContact: "123" }).alternateContact).toMatch(/10-digit/i);
  });

  it("allows blank professional profile links but rejects malformed ones", () => {
    expect(errorsFor({ github: "" })).toEqual({});
    expect(errorsFor({ github: "not a url" }).github).toMatch(/valid url/i);
  });

  it("rejects an unrealistic passing year", () => {
    expect(errorsFor({ passingYear: 1998 }).passingYear).toMatch(/realistic/i);
  });

  it("reports every problem at once so the student fixes them in one pass", () => {
    const errors = errorsFor({
      mobile: "abc",
      semesters: [{ semesterNumber: 1, cgpa: 99, currentArrears: 0, historyOfArrears: 0 }],
      degree: "",
      roleCategories: [],
      resumeCategories: [],
    });
    expect(Object.keys(errors).sort()).toEqual(["degree", "mobile", "roleCategories", "semesters"]);
  });
});
