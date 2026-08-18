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
  shiftType: "day",
  bondDetails: "No bond",
  joiningTimeline: "immediate",
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

  it.each(["companyName", "spocEmail", "roleTitle", "roleCategory", "workLocations"])(
    "refuses to submit without %s",
    (field) => {
      const result = pifSubmitSchema.safeParse({ ...complete, [field]: "" });
      expect(result.success).toBe(false);
    },
  );

  /**
   * 2026-08-18, answer 2: "keep space to type JD. Field is not mandatory."
   *
   * The recruiter's PDF is now attachable (answer 1), and a JD that arrived as
   * an attachment does not need retyping before the PIF can move. It stopped
   * being required on that day and not before: until the attachment existed,
   * an empty description meant the drive had none at all.
   */
  it("submits with no typed job description, now that the PDF can carry it", () => {
    expect(pifSubmitSchema.safeParse({ ...complete, jobDescription: "" }).success).toBe(true);
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

  /**
   * 2026-08-18, J1: the recruiter's own JD, attached.
   *
   * The file itself is validated by `@domain/attachments`, which the bucket in
   * `0051` mirrors. The schema's job is only to carry it and to refuse one
   * that could never be stored.
   */
  describe("the attached job description", () => {
    const pdf = (over: Partial<{ name: string; size: number; type: string }> = {}) =>
      new File([new Uint8Array(2048)], over.name ?? "jd.pdf", {
        type: over.type ?? "application/pdf",
      });

    it("submits with no attachment — it is optional", () => {
      expect(pifSubmitSchema.safeParse({ ...complete, jobDescriptionFile: null }).success).toBe(
        true,
      );
    });

    it("accepts a PDF", () => {
      expect(pifSubmitSchema.safeParse({ ...complete, jobDescriptionFile: pdf() }).success).toBe(
        true,
      );
    });

    it("refuses anything that is not a PDF, in a draft as well as a submission", () => {
      const notPdf = pdf({ name: "jd.docx", type: "application/msword" });

      expect(pifSubmitSchema.safeParse({ ...complete, jobDescriptionFile: notPdf }).success).toBe(
        false,
      );
      // A draft may be half-finished, but it may not hold a file the bucket
      // will refuse: the AE would lose the upload without being told why.
      expect(
        pifDraftSchema.safeParse({ ...PIF_DEFAULTS, companyName: "Z", jobDescriptionFile: notPdf })
          .success,
      ).toBe(false);
    });
  });

  /**
   * 2026-08-18, J2: Day / Night / Rotational / Flexible, with the hours typed
   * in for a night shift.
   */
  describe("the shift", () => {
    it("accepts each of the four shifts", () => {
      for (const shift of ["day", "rotational", "flexible"]) {
        expect(pifSubmitSchema.safeParse({ ...complete, shiftType: shift }).success).toBe(true);
      }
      expect(
        pifSubmitSchema.safeParse({ ...complete, shiftType: "night", shiftNightTiming: "9pm–6am" })
          .success,
      ).toBe(true);
    });

    it("refuses free text where a shift is expected", () => {
      // What the live drives contain. It is a legacy value, not an answer the
      // form may collect again.
      expect(pifSubmitSchema.safeParse({ ...complete, shiftType: "General" }).success).toBe(false);
    });

    it("refuses a night shift with no hours, and says so against the timing", () => {
      const parsed = pifSubmitSchema.safeParse({
        ...complete,
        shiftType: "night",
        shiftNightTiming: "  ",
      });

      expect(parsed.success).toBe(false);
      expect(parsed.success ? "" : parsed.error.issues[0]?.path).toEqual(["shiftNightTiming"]);
    });

    it("lets a draft be saved before the hours are known", () => {
      expect(
        pifDraftSchema.safeParse({ ...PIF_DEFAULTS, companyName: "Z", shiftType: "night" }).success,
      ).toBe(true);
    });

    it("drops a timing left behind by a switch back to a day shift", () => {
      const parsed = pifSubmitSchema.parse({
        ...complete,
        shiftType: "day",
        shiftNightTiming: "9pm–6am",
      });

      expect(parsed.shiftNightTiming).toBe("");
    });

    it("still allows no shift at all — it was never a required field", () => {
      expect(pifSubmitSchema.safeParse({ ...complete, shiftType: "" }).success).toBe(true);
    });
  });

  /**
   * 2026-08-18, J3: immediate or later, with one comment box per option
   * (answer 6), the choice required at submit and the comment optional
   * (answer 7).
   */
  describe("the joining timeline", () => {
    it("requires the choice before the PIF may be submitted", () => {
      const parsed = pifSubmitSchema.safeParse({ ...complete, joiningTimeline: "" });

      expect(parsed.success).toBe(false);
      expect(parsed.success ? "" : parsed.error.issues[0]?.message).toMatch(/joining/i);
    });

    it("lets a draft be saved before the recruiter has said", () => {
      expect(pifDraftSchema.safeParse({ ...PIF_DEFAULTS, companyName: "Zoho" }).success).toBe(true);
    });

    it("accepts either option with no comment at all", () => {
      expect(pifSubmitSchema.safeParse({ ...complete, joiningTimeline: "later" }).success).toBe(
        true,
      );
    });

    it("keeps only the comment belonging to the option that was chosen", () => {
      const parsed = pifSubmitSchema.parse({
        ...complete,
        joiningTimeline: "later",
        joiningImmediateNotes: "Within 30 days",
        joiningLaterNotes: " Offers in Nov 2026, joining July 2027 ",
      });

      expect(parsed.joiningLaterNotes).toBe("Offers in Nov 2026, joining July 2027");
      // Switching the radio must not leave a note about immediate joining on a
      // drive that now says July.
      expect(parsed.joiningImmediateNotes).toBe("");
    });
  });

  it("leaves offer category out entirely - it is the Delivery Head's, not the AE's", () => {
    const parsed = pifSubmitSchema.parse(complete);
    expect("offerCategory" in parsed).toBe(false);
  });
});
