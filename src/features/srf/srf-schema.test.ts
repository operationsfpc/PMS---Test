import { describe, expect, it } from "vitest";
import { SRF_DEFAULTS, type SrfFormValues, srfSchema } from "./srf-schema";

const valid: SrfFormValues = {
  ...SRF_DEFAULTS,
  mobile: "9876543210",
  // Mandatory since 2026-08-04.
  alternateContact: "9876500000",
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  overallCgpa: 8.24,
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

  it("rejects arrear history lower than standing arrears", () => {
    expect(errorsFor({ currentArrears: 3, historyOfArrears: 1 }).historyOfArrears).toMatch(
      /cannot be lower/i,
    );
  });

  it("accepts cleared backlogs — history above current", () => {
    expect(errorsFor({ currentArrears: 0, historyOfArrears: 4 })).toEqual({});
  });

  it("rejects a percentage typed into the CGPA field", () => {
    expect(errorsFor({ overallCgpa: 82.4 }).overallCgpa).toMatch(/10-point scale/i);
  });

  it("rejects marks above 100", () => {
    expect(errorsFor({ tenthPercentage: 105 }).tenthPercentage).toMatch(/between 0 and 100/i);
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
      overallCgpa: 99,
      degree: "",
      roleCategories: [],
      resumeCategories: [],
    });
    expect(Object.keys(errors).sort()).toEqual([
      "degree",
      "mobile",
      "overallCgpa",
      "roleCategories",
    ]);
  });
});
