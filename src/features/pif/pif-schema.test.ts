import { describe, expect, it } from "vitest";
import { PIF_DEFAULTS, pifDraftSchema, pifSubmitSchema } from "./pif-schema";

/**
 * The AE's PIF contract (Sections 1-4).
 *
 * Two schemas, deliberately: a DRAFT may be saved half-finished, but SUBMIT
 * hands the PIF to the Delivery Head and must be complete. One schema with
 * everything optional would let an empty PIF reach an approver.
 */
const complete = {
  ...PIF_DEFAULTS,
  companyName: "Zoho Corporation",
  industry: "Software",
  companyWebsite: "https://zoho.com",
  spocName: "R Karthik",
  spocDesignation: "Talent Acquisition Lead",
  spocEmail: "karthik@zoho.com",
  spocPhone: "9876543210",
  roleTitle: "Member Technical Staff",
  roleCategory: "software_technical",
  jobDescription: "Build and maintain backend services.",
  openings: 25,
  workLocations: "Chennai, Tenkasi",
  ctcMinLpa: 6.5,
  ctcMaxLpa: 9,
  ctcBreakup: "6.5 fixed + 2.5 variable",
  shiftType: "general",
  bondDetails: "No bond",
  arrearsPolicy: "no_standing",
  eligiblePassingYears: [2027],
  driveMode: "on_campus",
  rounds: [
    { sequence: 1, name: "Aptitude test" },
    { sequence: 2, name: "Technical interview" },
    { sequence: 3, name: "HR" },
  ],
};

describe("pifDraftSchema", () => {
  it("accepts an almost-empty draft, so an AE can save and come back", () => {
    const result = pifDraftSchema.safeParse({ ...PIF_DEFAULTS, companyName: "Zoho" });
    expect(result.success).toBe(true);
  });

  it("still insists on a company name - a PIF with no company is not a draft of anything", () => {
    const result = pifDraftSchema.safeParse(PIF_DEFAULTS);
    expect(result.success).toBe(false);
  });
});

describe("pifSubmitSchema", () => {
  it("accepts a complete PIF", () => {
    const result = pifSubmitSchema.safeParse(complete);
    expect(result.success).toBe(true);
  });

  it.each([
    "companyName",
    "spocEmail",
    "roleTitle",
    "roleCategory",
    "jobDescription",
    "workLocations",
  ])("refuses to submit without %s", (field) => {
    const result = pifSubmitSchema.safeParse({ ...complete, [field]: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed contact email", () => {
    const result = pifSubmitSchema.safeParse({ ...complete, spocEmail: "karthik@" });
    expect(result.success).toBe(false);
  });

  it("rejects a website that is not a URL", () => {
    const result = pifSubmitSchema.safeParse({ ...complete, companyWebsite: "zoho" });
    expect(result.success).toBe(false);
  });

  it("allows the website to be omitted entirely", () => {
    const result = pifSubmitSchema.safeParse({ ...complete, companyWebsite: "" });
    expect(result.success).toBe(true);
  });

  it("requires at least one opening", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, openings: 0 }).success).toBe(false);
  });

  it("requires a minimum CTC, because offer category is suggested from it", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, ctcMinLpa: null }).success).toBe(false);
  });

  it("refuses a CTC range whose ceiling is below its floor", () => {
    const result = pifSubmitSchema.safeParse({ ...complete, ctcMinLpa: 9, ctcMaxLpa: 6 });
    expect(result.success).toBe(false);
  });

  it("accepts a fixed CTC, where there is no ceiling at all", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, ctcMaxLpa: null }).success).toBe(true);
  });

  it("requires at least one passing year", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, eligiblePassingYears: [] }).success).toBe(
      false,
    );
  });

  it("keeps a CGPA cutoff on the 10-point scale", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, minOverallCgpa: 11 }).success).toBe(false);
    expect(pifSubmitSchema.safeParse({ ...complete, minOverallCgpa: 7.5 }).success).toBe(true);
  });

  /**
   * F12 (UAT 2026-08-06): "Under eligibility criteria the Minimum overall CGPA
   * must be acceptable of both percentage and GPA."
   *
   * Recruiters state the bar the way their own HR does. Forcing 65% to be
   * typed as 6.84 makes the AE do the conversion, in their head, on the number
   * that decides who may apply.
   */
  it("accepts the cutoff as a percentage when the recruiter states one", () => {
    const result = pifSubmitSchema.safeParse({
      ...complete,
      minOverallCgpa: 65,
      minOverallCgpaScale: "percentage",
    });

    expect(result.success).toBe(true);
  });

  it("still refuses a percentage above 100", () => {
    const result = pifSubmitSchema.safeParse({
      ...complete,
      minOverallCgpa: 101,
      minOverallCgpaScale: "percentage",
    });

    expect(result.success).toBe(false);
  });

  it("refuses a figure that is only valid on the other scale", () => {
    const result = pifSubmitSchema.safeParse({
      ...complete,
      minOverallCgpa: 65,
      minOverallCgpaScale: "cgpa",
    });

    expect(result.success).toBe(false);
  });

  it("defaults to CGPA, so an unanswered scale cannot silently mean percentage", () => {
    expect(pifSubmitSchema.parse(complete).minOverallCgpaScale).toBe("cgpa");
  });

  it("allows no cutoff at all, on either scale", () => {
    expect(
      pifSubmitSchema.safeParse({
        ...complete,
        minOverallCgpa: null,
        minOverallCgpaScale: "percentage",
      }).success,
    ).toBe(true);
  });

  /**
   * F11 (UAT 2026-08-06): "Account Executive we should collect the number of
   * rounds for the drive and should reflect in the Central placement
   * coordinator login where they are trying to publish the drive."
   *
   * The Central CPC was typing the round list from memory, or from an email.
   */
  /**
   * SPEC CHANGE 2026-08-18: the AE NAMES the rounds rather than counting them.
   * "AE name them on the PIF with Round Number - Round 1 - Aptitude Test;
   * Round 2 - Interview" - they are the logical rounds a student progresses
   * through, and "Round 2" is not something anyone can prepare for.
   */
  it("requires the rounds before the PIF may be submitted", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, rounds: [] }).success).toBe(false);
  });

  it("refuses a round nobody has named", () => {
    const parsed = pifSubmitSchema.safeParse({
      ...complete,
      rounds: [{ sequence: 1, name: "  " }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toMatch(/name every round/i);
  });

  it("lets a draft be saved before the rounds are known", () => {
    expect(
      pifDraftSchema.safeParse({ ...PIF_DEFAULTS, companyName: "Zoho", rounds: [] }).success,
    ).toBe(true);
  });

  /**
   * F7 (UAT 2026-08-06): "If its one interview process, multiple designations
   * only one PIF is required, if multiple interview process for multiple
   * designations then multiple PIF is required."
   *
   * So the PIF must be able to name more than one designation. Raising a
   * second PIF for a second job title on the same interview day would double
   * the drive, the shortlist and the audience count.
   */
  it("accepts further designations covered by the same interview process", () => {
    const result = pifSubmitSchema.safeParse({
      ...complete,
      additionalDesignations: ["Associate Engineer", "Trainee Engineer"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additionalDesignations).toEqual([
        "Associate Engineer",
        "Trainee Engineer",
      ]);
    }
  });

  it("drops blank designation rows rather than storing empty job titles", () => {
    const result = pifSubmitSchema.parse({
      ...complete,
      additionalDesignations: ["Associate Engineer", "  ", ""],
    });

    expect(result.additionalDesignations).toEqual(["Associate Engineer"]);
  });

  it("refuses a designation that merely repeats the role title", () => {
    const result = pifSubmitSchema.safeParse({
      ...complete,
      additionalDesignations: ["Member Technical Staff"],
    });

    expect(result.success).toBe(false);
  });

  it("names no extra designations by default", () => {
    expect(pifSubmitSchema.parse(complete).additionalDesignations).toEqual([]);
  });

  it("leaves offer category out entirely - it is the Delivery Head's, not the AE's", () => {
    const parsed = pifSubmitSchema.parse(complete);
    expect("offerCategory" in parsed).toBe(false);
  });
});
