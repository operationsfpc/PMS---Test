import { describe, expect, it } from "vitest";
import {
  type CampusProgramme,
  programmeKey,
  programmeLabel,
  programmesFor,
  splitProgrammeKey,
  validateProgramme,
} from "./programmes";

/**
 * F6 (UAT 2026-08-06): "A separate page for degree and branches is not
 * required for the admin. This is always mapped to colleges for a particular
 * year of Passing. Degree+Branch is one field. This can be added or edited
 * later under the colleges created. Students can just select this from a drop
 * down while filling the form."
 *
 * A degree with no branch is not something anybody runs, and neither half is
 * meaningful without the college and the year that offers it: B.E CSE at one
 * campus for 2027 is a different cohort from B.E CSE at another for 2026.
 */
const programme = (over: Partial<CampusProgramme> = {}): CampusProgramme => ({
  campusId: "c1",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2027,
  ...over,
});

describe("programmeLabel", () => {
  it("reads as one field, because that is what it is", () => {
    expect(programmeLabel("B.E", "CSE")).toBe("B.E — CSE");
  });

  it("does not leave a dangling separator when there is no branch", () => {
    expect(programmeLabel("MBA", "")).toBe("MBA");
  });

  it("tidies the spacing a human left behind", () => {
    expect(programmeLabel("  B.E ", " CSE ")).toBe("B.E — CSE");
  });
});

/**
 * The dropdown needs one value per option, and the form needs both halves back
 * out of it — students still store a degree and a branch.
 */
describe("programmeKey and splitProgrammeKey", () => {
  it("round-trips a degree and a branch", () => {
    expect(splitProgrammeKey(programmeKey("B.E", "CSE"))).toEqual({
      degree: "B.E",
      branch: "CSE",
    });
  });

  it("round-trips a programme with no branch", () => {
    expect(splitProgrammeKey(programmeKey("MBA", ""))).toEqual({ degree: "MBA", branch: "" });
  });

  /** A degree containing the separator must not split into the wrong halves. */
  it("survives a degree name that contains the separator", () => {
    const key = programmeKey("B.Tech / B.E", "CSE");

    expect(splitProgrammeKey(key)).toEqual({ degree: "B.Tech / B.E", branch: "CSE" });
  });

  it("reads an unrecognised value as nothing rather than guessing", () => {
    expect(splitProgrammeKey("")).toEqual({ degree: "", branch: "" });
  });
});

describe("programmesFor", () => {
  const all = [
    programme(),
    programme({ branch: "ECE" }),
    programme({ passingYear: 2026 }),
    programme({ campusId: "c2" }),
  ];

  it("offers only what that college runs for that passing year", () => {
    const offered = programmesFor(all, { campusId: "c1", passingYear: 2027 });

    expect(offered.map((p) => p.branch)).toEqual(["CSE", "ECE"]);
  });

  it("offers nothing for a college that runs nothing that year", () => {
    expect(programmesFor(all, { campusId: "c1", passingYear: 2030 })).toEqual([]);
  });

  it("sorts them the way a dropdown should read", () => {
    const offered = programmesFor(
      [programme({ branch: "Mechanical" }), programme({ branch: "AI and DS" })],
      { campusId: "c1", passingYear: 2027 },
    );

    expect(offered.map((p) => p.branch)).toEqual(["AI and DS", "Mechanical"]);
  });

  it("sorts by degree before branch", () => {
    const offered = programmesFor(
      [programme({ degree: "B.Tech", branch: "AI" }), programme({ degree: "B.E", branch: "ZZ" })],
      { campusId: "c1", passingYear: 2027 },
    );

    expect(offered.map((p) => p.degree)).toEqual(["B.E", "B.Tech"]);
  });
});

describe("validateProgramme", () => {
  it("accepts a college, a degree, a branch and a year", () => {
    expect(validateProgramme(programme())).toEqual([]);
  });

  it("refuses one with no degree", () => {
    const problems = validateProgramme(programme({ degree: " " }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/degree/i);
  });

  it("refuses one with no college behind it", () => {
    expect(validateProgramme(programme({ campusId: "" }))[0]).toMatch(/college/i);
  });

  /** A passing year is what makes it a cohort rather than a catalogue entry. */
  it("refuses an implausible passing year", () => {
    expect(validateProgramme(programme({ passingYear: 1900 }))[0]).toMatch(/year/i);
    expect(validateProgramme(programme({ passingYear: 2400 }))[0]).toMatch(/year/i);
  });

  /** A degree that genuinely has no branches (MBA) is normal. */
  it("allows a programme with no branch", () => {
    expect(validateProgramme(programme({ degree: "MBA", branch: "" }))).toEqual([]);
  });

  it("reports every problem at once", () => {
    expect(
      validateProgramme({ campusId: "", degree: "", branch: "", passingYear: 0 }).length,
    ).toBeGreaterThan(1);
  });
});
