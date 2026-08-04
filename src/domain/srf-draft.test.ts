import { describe, expect, it } from "vitest";
import { mergeSrfDraft } from "./srf-draft";

/**
 * Resuming a saved registration form.
 *
 * The rule that matters: IDENTITY ALWAYS COMES FROM THE ROSTER, never from the
 * draft. A draft can be weeks old and the college may have corrected a roll
 * number or a branch since. Letting a stale draft win would quietly restore
 * the old value and send it for verification, where it fails against the
 * marksheet - and the student is blamed for it.
 *
 * Everything else is the student's own work and is restored exactly.
 */
const DEFAULTS = {
  fullName: "",
  rollNumber: "",
  email: "",
  degree: "",
  branch: "",
  passingYear: Number.NaN,
  mobile: "",
  technicalSkills: "",
};

const ROSTER = {
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
};

describe("mergeSrfDraft", () => {
  it("restores what the student had typed", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      mobile: "9876543210",
      technicalSkills: "TypeScript",
    });

    expect(merged.mobile).toBe("9876543210");
    expect(merged.technicalSkills).toBe("TypeScript");
  });

  it("takes identity from the roster, not from the draft", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      rollNumber: "OLD-ROLL",
      branch: "ECE",
      fullName: "Old Name",
      passingYear: 2025,
    });

    expect(merged.rollNumber).toBe("21CSE1042");
    expect(merged.branch).toBe("CSE");
    expect(merged.fullName).toBe("Asha Rao");
    expect(merged.passingYear).toBe(2026);
  });

  it("falls back to the defaults for anything neither has", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, { mobile: "9876543210" });

    expect(merged.technicalSkills).toBe("");
  });

  it("returns the roster-prefilled form when there is no draft", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, null);

    expect(merged.fullName).toBe("Asha Rao");
    expect(merged.mobile).toBe("");
  });

  it("survives a student with no roster record at all", () => {
    const merged = mergeSrfDraft(DEFAULTS, null, { mobile: "9876543210" });

    expect(merged.mobile).toBe("9876543210");
    expect(merged.fullName).toBe("");
  });

  it("ignores a draft that is not an object, rather than crashing the form", () => {
    for (const junk of ["nonsense", 42, [], null]) {
      expect(mergeSrfDraft(DEFAULTS, ROSTER, junk as never).fullName).toBe("Asha Rao");
    }
  });

  /**
   * A draft written by an older version of the form can carry fields that no
   * longer exist. They must not travel into the form state, where they would
   * be submitted and rejected by the schema.
   */
  it("drops keys the form no longer has", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      mobile: "9876543210",
      overallCgpa: 8.2,
    } as never);

    expect(merged).not.toHaveProperty("overallCgpa");
  });

  /**
   * Some degrees have no branch at all (A11), so the roster record legitimately
   * arrives with the field missing. Writing `undefined` over the default would
   * turn a controlled input into an uncontrolled one mid-render.
   */
  it("leaves a field the roster does not have alone", () => {
    const merged = mergeSrfDraft(DEFAULTS, { ...ROSTER, branch: undefined }, {
      branch: "ECE",
    } as never);

    expect(merged.branch).toBe("ECE");
  });

  it("does not mutate the defaults it was given", () => {
    const defaults = { ...DEFAULTS };
    mergeSrfDraft(defaults, ROSTER, { mobile: "9876543210" });

    expect(defaults.mobile).toBe("");
  });
});
