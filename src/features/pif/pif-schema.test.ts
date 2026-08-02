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

  it("leaves offer category out entirely - it is the Delivery Head's, not the AE's", () => {
    const parsed = pifSubmitSchema.parse(complete);
    expect("offerCategory" in parsed).toBe(false);
  });
});
