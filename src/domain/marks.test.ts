import { describe, expect, it } from "vitest";
import {
  describeMarks,
  isValidForScale,
  MARKS_SCALES,
  type MarksScale,
  normaliseToCgpa,
  PERCENTAGE_TO_CGPA_DIVISOR,
} from "./marks";

/**
 * College marks arrive on two different scales.
 *
 * Asked for 2026-08-06: "some colleges have CGPA and some have % in college
 * marks. have an option for students to select relevant field and enter that."
 *
 * Every eligibility cutoff in the system is a CGPA on the 10-point scale
 * (`drives.min_overall_cgpa`), so a percentage has to be converted before it
 * can be compared to anything. That conversion decides WHO MAY APPLY TO A
 * DRIVE, which is why it lives here, alone, behind one constant — and not
 * inline at three different call sites that could drift apart.
 */

describe("the scales themselves", () => {
  it("offers exactly the two a college actually uses", () => {
    expect(MARKS_SCALES).toEqual(["cgpa", "percentage"]);
  });
});

describe("isValidForScale", () => {
  it("holds a CGPA to the 10-point scale", () => {
    expect(isValidForScale(8.24, "cgpa")).toBe(true);
    expect(isValidForScale(10, "cgpa")).toBe(true);
    expect(isValidForScale(0, "cgpa")).toBe(true);
    expect(isValidForScale(10.1, "cgpa")).toBe(false);
    expect(isValidForScale(-0.1, "cgpa")).toBe(false);
  });

  /** 78 is a perfectly good percentage and a nonsense CGPA. */
  it("lets a percentage go all the way to 100", () => {
    expect(isValidForScale(78, "percentage")).toBe(true);
    expect(isValidForScale(100, "percentage")).toBe(true);
    expect(isValidForScale(100.5, "percentage")).toBe(false);
  });

  it("rejects anything that is not a number", () => {
    expect(isValidForScale(Number.NaN, "cgpa")).toBe(false);
    expect(isValidForScale(Number.POSITIVE_INFINITY, "percentage")).toBe(false);
  });
});

describe("normaliseToCgpa", () => {
  it("leaves a CGPA exactly as it is", () => {
    expect(normaliseToCgpa(8.24, "cgpa")).toBe(8.24);
  });

  /**
   * ⚠️ The number that decides eligibility for every percentage-scale college.
   * 9.5 is the common Indian convention (CBSE, and most affiliating
   * universities). A32/A33 in docs/ASSUMPTIONS.md — one constant to change.
   */
  it("converts a percentage using the documented divisor", () => {
    expect(PERCENTAGE_TO_CGPA_DIVISOR).toBe(9.5);
    expect(normaliseToCgpa(95, "percentage")).toBe(10);
    expect(normaliseToCgpa(78, "percentage")).toBe(8.21);
  });

  it("never returns more than a 10, however high the percentage", () => {
    // 100 / 9.5 is 10.53, which is not a CGPA and would clear every cutoff
    // ever set, including ones the student does not actually meet.
    expect(normaliseToCgpa(100, "percentage")).toBe(10);
  });

  it("rounds to two places, so a stored figure and a compared one agree", () => {
    // Floating point: 78 / 9.5 is 8.2105263157... Comparing an unrounded
    // value against a stored numeric(4,2) is how marks comparisons drift.
    expect(normaliseToCgpa(78, "percentage")).toBe(8.21);
    expect(normaliseToCgpa(60, "percentage")).toBe(6.32);
  });

  it("treats a zero as a zero, not as missing", () => {
    expect(normaliseToCgpa(0, "percentage")).toBe(0);
    expect(normaliseToCgpa(0, "cgpa")).toBe(0);
  });
});

describe("describeMarks", () => {
  it("says which scale a figure was declared on, so nothing is ambiguous", () => {
    expect(describeMarks(8.24, "cgpa")).toBe("8.24 CGPA");
    expect(describeMarks(78, "percentage")).toBe("78%");
  });

  /**
   * A coordinator verifying against a marksheet must see what the student
   * TYPED, not a converted figure they cannot find on the document.
   */
  it("shows a percentage as a percentage, never as its converted CGPA", () => {
    expect(describeMarks(78, "percentage")).not.toContain("8.21");
  });
});

describe("every scale is handled", () => {
  it.each(MARKS_SCALES)("%s has a validator and a conversion", (scale: MarksScale) => {
    expect(isValidForScale(5, scale)).toBe(true);
    expect(normaliseToCgpa(5, scale)).toBeGreaterThan(0);
    expect(describeMarks(5, scale)).toContain("5");
  });
});
