import { describe, expect, it } from "vitest";
import { type SrfProgressInput, srfCompletion, srfSectionProgress } from "./srf-progress";

/**
 * Real-time progress through the seven-step registration form.
 *
 * UAT 2026-08-05: "the progress tracker does not accurately reflect the
 * student's real-time progress." It was hardcoded — the first pill was always
 * lit and the other six never were, whatever the student had filled in.
 *
 * A progress bar that lies is worse than none: a student who believes they
 * have finished stops, and their form sits unsubmitted until someone chases
 * them. So "complete" here means exactly what the schema will accept, and
 * nothing looser.
 */
const EMPTY: SrfProgressInput = {
  mobile: "",
  alternateContact: "",
  tenthInstitution: "",
  tenthPercentage: Number.NaN,
  twelfthInstitution: "",
  twelfthPercentage: Number.NaN,
  hasDiplomaMarks: false,
  programmeLevel: "ug",
  ugAggregateCgpa: null,
  semesters: [],
  marksheets: [],
  roleCategories: [],
  resumeCategories: [],
  consent: false,
};

const FILLED: SrfProgressInput = {
  mobile: "9876543210",
  alternateContact: "9876500000",
  tenthInstitution: "St Xavier's, Chennai",
  tenthPercentage: 91.4,
  twelfthInstitution: "St Xavier's, Chennai",
  twelfthPercentage: 88,
  hasDiplomaMarks: false,
  programmeLevel: "ug",
  ugAggregateCgpa: null,
  semesters: [{ semesterNumber: 1, cgpa: 8.24 }],
  marksheets: ["tenth", "twelfth", "semester-1"],
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
};

const section = (input: SrfProgressInput, id: string) =>
  srfSectionProgress(input).find((s) => s.id === id);

describe("srfSectionProgress", () => {
  /**
   * SPEC CHANGE 2026-08-06: "do not keep marksheet upload as a separate
   * section 3. upload near relevant fields in section 2 itself." A student had
   * to enter a mark in one section and then find its document in another,
   * matching them up by memory - which is also how a marksheet ended up
   * against the wrong semester.
   */
  it("reports all six steps, in order", () => {
    const sections = srfSectionProgress(EMPTY);

    expect(sections).toHaveLength(6);
    expect(sections.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("has no separate marksheet section at all", () => {
    expect(srfSectionProgress(EMPTY).some((s) => s.id === "marksheets")).toBe(false);
  });

  /**
   * The old tracker lit step 1 the moment the form opened, before a single
   * field was touched. Nothing the student must do starts complete.
   */
  it("lights no required step until the student has done something", () => {
    const required = srfSectionProgress(EMPTY).filter((s) => !s.optional);

    expect(required).toHaveLength(4);
    expect(required.every((s) => !s.complete)).toBe(true);
  });

  it("completes personal details once both numbers are given", () => {
    expect(section(EMPTY, "personal")?.complete).toBe(false);
    expect(section({ ...EMPTY, mobile: "9876543210" }, "personal")?.complete).toBe(false);
    expect(section(FILLED, "personal")?.complete).toBe(true);
  });

  it("needs the marks and at least one semester before academics count", () => {
    expect(section({ ...FILLED, semesters: [] }, "academic")?.complete).toBe(false);
    expect(section({ ...FILLED, tenthPercentage: Number.NaN }, "academic")?.complete).toBe(false);
    expect(section(FILLED, "academic")?.complete).toBe(true);
  });

  it("does not count a semester the student has left blank", () => {
    expect(
      section({ ...FILLED, semesters: [{ semesterNumber: 1, cgpa: Number.NaN }] }, "academic")
        ?.complete,
    ).toBe(false);
  });

  /** A postgraduate has a whole completed degree the form must still capture. */
  it("asks a postgraduate for their UG aggregate before academics count", () => {
    const pg = {
      ...FILLED,
      programmeLevel: "pg" as const,
      ugAggregateCgpa: null,
      marksheets: [...FILLED.marksheets, "ug_consolidated"],
    };

    expect(section(pg, "academic")?.complete).toBe(false);
    expect(section({ ...pg, ugAggregateCgpa: 7.8 }, "academic")?.complete).toBe(true);
  });

  /**
   * SPEC CHANGE. This used to be its own section that went green once ANY
   * single file was picked. The uploads were also being discarded entirely, so
   * a student could be shown a finished form having evidenced nothing. The
   * marks and their documents are now one section, and it is not done until
   * every declared figure carries its evidence.
   */
  it("is not done until every declared figure is evidenced", () => {
    expect(section({ ...FILLED, marksheets: ["tenth"] }, "academic")?.complete).toBe(false);
    expect(section({ ...FILLED, marksheets: ["tenth", "twelfth"] }, "academic")?.complete).toBe(
      false,
    );
    expect(section(FILLED, "academic")?.complete).toBe(true);
  });

  it("re-opens academics when a new semester is declared but not evidenced", () => {
    const two = {
      ...FILLED,
      semesters: [
        { semesterNumber: 1, cgpa: 8.24 },
        { semesterNumber: 2, cgpa: 8.4 },
      ],
    };

    expect(section(two, "academic")?.complete).toBe(false);
    expect(
      section({ ...two, marksheets: [...two.marksheets, "semester-2"] }, "academic")?.complete,
    ).toBe(true);
  });

  it("asks a postgraduate for their consolidated UG marksheet too", () => {
    const pg = { ...FILLED, programmeLevel: "pg" as const, ugAggregateCgpa: 7.8 };

    expect(section(pg, "academic")?.complete).toBe(false);
    expect(
      section({ ...pg, marksheets: [...pg.marksheets, "ug_consolidated"] }, "academic")?.complete,
    ).toBe(true);
  });

  /** Optional to declare; once declared, it must be evidenced like any mark. */
  it("requires a diploma marksheet only once diploma marks are declared", () => {
    expect(section({ ...FILLED, hasDiplomaMarks: true }, "academic")?.complete).toBe(false);
    expect(
      section(
        { ...FILLED, hasDiplomaMarks: true, marksheets: [...FILLED.marksheets, "diploma"] },
        "academic",
      )?.complete,
    ).toBe(true);
  });

  /** The school name sits before the marks it belongs to (2026-08-06). */
  it("needs the school each figure came from", () => {
    expect(section({ ...FILLED, tenthInstitution: "" }, "academic")?.complete).toBe(false);
    expect(section({ ...FILLED, twelfthInstitution: "  " }, "academic")?.complete).toBe(false);
  });

  it("needs a resume for every category chosen before preferences count", () => {
    expect(section({ ...FILLED, resumeCategories: [] }, "preferences")?.complete).toBe(false);
    expect(section(FILLED, "preferences")?.complete).toBe(true);
  });

  it("completes consent only when it is actually given", () => {
    expect(section({ ...FILLED, consent: false }, "consent")?.complete).toBe(false);
    expect(section(FILLED, "consent")?.complete).toBe(true);
  });

  /**
   * Optional sections are marked so, and count as done. Showing a student
   * 5 of 7 forever because they have no GitHub would be a lie in the other
   * direction.
   */
  it("marks the optional sections optional, and does not hold progress back", () => {
    const profiles = section(EMPTY, "profiles");

    expect(profiles?.optional).toBe(true);
    expect(profiles?.complete).toBe(true);
    expect(section(EMPTY, "additional")?.optional).toBe(true);
  });

  it("marks the required sections required", () => {
    expect(section(EMPTY, "personal")?.optional).toBe(false);
  });

  it("names every section for a human", () => {
    expect(srfSectionProgress(EMPTY).map((s) => s.title)).toEqual([
      "Personal details",
      "Academic record",
      "Placement preferences",
      "Professional profiles",
      "Skills and achievements",
      "Consent and submission",
    ]);
  });
});

describe("srfCompletion", () => {
  it("is zero when nothing required is done", () => {
    // The two optional sections are complete from the start, and are excluded:
    // progress must measure what the student still has to do.
    expect(srfCompletion(EMPTY)).toBe(0);
  });

  it("is a hundred when every required section is done", () => {
    expect(srfCompletion(FILLED)).toBe(100);
  });

  it("counts only the required sections, so the optional ones cannot flatter it", () => {
    // 4 required sections; personal alone is 25%.
    expect(srfCompletion({ ...EMPTY, mobile: "9876543210", alternateContact: "9876500000" })).toBe(
      25,
    );
  });
});
