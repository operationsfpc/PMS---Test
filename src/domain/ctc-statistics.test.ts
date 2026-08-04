import { describe, expect, it } from "vitest";
import { type PlacementCtc, summariseCtc, summariseCtcByCategory } from "./ctc-statistics";

/**
 * CTC reporting.
 *
 * The trap this module exists to avoid: a student who holds three offers must
 * count ONCE, at the offer that is their placement record (R9). Averaging
 * every offer row instead inflates the figure, disagrees with the "placed"
 * count on the same screen, and flatters the team's work — which is exactly
 * the number a board meeting will quote.
 *
 * Every figure is in LPA, and CTC is money: nothing here compares floats for
 * equality, and every published figure is rounded explicitly.
 */

const record = (
  studentId: string,
  ctcLpa: number,
  category: PlacementCtc["category"] = "dream",
): PlacementCtc => ({
  studentId,
  ctcLpa,
  category,
});

describe("summariseCtc", () => {
  it("counts one figure per placed student", () => {
    const stats = summariseCtc([record("s1", 6), record("s2", 12)]);

    expect(stats.count).toBe(2);
  });

  it("reports the highest and lowest package", () => {
    const stats = summariseCtc([record("s1", 6), record("s2", 12), record("s3", 8.5)]);

    expect(stats.highestLpa).toBe(12);
    expect(stats.lowestLpa).toBe(6);
  });

  it("averages to two decimals, so a third of a lakh does not print forever", () => {
    const stats = summariseCtc([record("s1", 6), record("s2", 7), record("s3", 8.5)]);

    expect(stats.averageLpa).toBe(7.17);
  });

  it("takes the middle figure as the median", () => {
    const stats = summariseCtc([record("s1", 6), record("s2", 30), record("s3", 8)]);

    expect(stats.medianLpa).toBe(8);
  });

  /**
   * The median is quoted precisely because one enormous package should not
   * move it. This is the case that proves it does not.
   */
  it("is not dragged by a single outlier the way the average is", () => {
    const stats = summariseCtc([
      record("s1", 6),
      record("s2", 6),
      record("s3", 6),
      record("s4", 60),
    ]);

    expect(stats.medianLpa).toBe(6);
    expect(stats.averageLpa).toBe(19.5);
  });

  it("averages the two middle figures when the count is even", () => {
    const stats = summariseCtc([
      record("s1", 6),
      record("s2", 7),
      record("s3", 8),
      record("s4", 9),
    ]);

    expect(stats.medianLpa).toBe(7.5);
  });

  it("reports nothing rather than zero when nobody is placed", () => {
    const stats = summariseCtc([]);

    expect(stats).toEqual({
      count: 0,
      highestLpa: null,
      lowestLpa: null,
      averageLpa: null,
      medianLpa: null,
    });
  });

  /** Zero is a real CTC. Reporting it as "no data" would hide a real problem. */
  it("distinguishes a zero package from no package at all", () => {
    const stats = summariseCtc([record("s1", 0)]);

    expect(stats.count).toBe(1);
    expect(stats.highestLpa).toBe(0);
    expect(stats.averageLpa).toBe(0);
  });

  it("does not let the input order change any figure", () => {
    const ascending = summariseCtc([record("s1", 6), record("s2", 8), record("s3", 12)]);
    const descending = summariseCtc([record("s3", 12), record("s2", 8), record("s1", 6)]);

    expect(descending).toEqual(ascending);
  });
});

describe("summariseCtcByCategory", () => {
  it("reports each category on the ladder, lowest first", () => {
    const byCategory = summariseCtcByCategory([
      record("s1", 14, "super_dream"),
      record("s2", 4, "regular"),
      record("s3", 8, "dream"),
    ]);

    expect(byCategory.map((c) => c.category)).toEqual(["regular", "dream", "super_dream"]);
  });

  it("summarises within a category, not across them", () => {
    const byCategory = summariseCtcByCategory([
      record("s1", 6, "dream"),
      record("s2", 8, "dream"),
      record("s3", 20, "super_dream"),
    ]);

    const dream = byCategory.find((c) => c.category === "dream");

    expect(dream?.stats.count).toBe(2);
    expect(dream?.stats.averageLpa).toBe(7);
  });

  it("omits a category nobody holds, rather than showing an empty row", () => {
    const byCategory = summariseCtcByCategory([record("s1", 8, "dream")]);

    expect(byCategory.map((c) => c.category)).toEqual(["dream"]);
  });

  /**
   * A plain internship is not on the ladder and carries no category (PRD §11).
   * It is still a real placement, so it is counted in the headline and simply
   * has no category row.
   */
  it("leaves an uncategorised placement out of the category breakdown", () => {
    const records = [record("s1", 8, "dream"), record("s2", 3, null)];

    expect(summariseCtcByCategory(records)).toHaveLength(1);
    expect(summariseCtc(records).count).toBe(2);
  });

  it("returns nothing when nobody is placed", () => {
    expect(summariseCtcByCategory([])).toEqual([]);
  });
});
