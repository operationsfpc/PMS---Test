import { describe, expect, it } from "vitest";
import { percentOf, roundMoney, roundPercent, roundTo } from "./math";

/**
 * Numeric helpers for money and marks (CLAUDE.md).
 *
 * A dashboard that prints "7.166666666666667 LPA" is not a rounding bug, it is
 * a credibility problem, and `Math.round` alone is subject to the very
 * representation error it is being used to hide.
 */
describe("roundTo", () => {
  it("rounds to the number of decimals asked for", () => {
    expect(roundTo(7.166666, 2)).toBe(7.17);
    expect(roundTo(7.164, 2)).toBe(7.16);
  });

  it("rounds a half up, the way a reader of money expects", () => {
    expect(roundTo(2.345, 2)).toBe(2.35);
    expect(roundTo(0.5, 0)).toBe(1);
  });

  /** Math.round(1.005 * 100) is 100. Scaling through the exponent is not. */
  it("survives the binary representation of a half", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
  });

  it("leaves a figure that is already short enough alone", () => {
    expect(roundTo(8, 2)).toBe(8);
  });

  it("passes a non-finite figure through rather than inventing one", () => {
    expect(roundTo(Number.NaN, 2)).toBeNaN();
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });

  it("handles a negative figure symmetrically", () => {
    expect(roundTo(-2.345, 2)).toBe(-2.35);
  });
});

describe("roundMoney and roundPercent", () => {
  it("publishes money to two decimals", () => {
    expect(roundMoney(7.16666)).toBe(7.17);
  });

  it("publishes a percentage to one", () => {
    expect(roundPercent(33.33333)).toBe(33.3);
  });
});

describe("percentOf", () => {
  it("expresses a part as a percentage of the whole", () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(3, 4)).toBe(75);
  });

  /**
   * No students means no rate. NaN and 100% are both lies a screen would
   * happily render.
   */
  it("is zero when there is nothing to divide by", () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
  });

  it("can exceed nothing and reach a hundred", () => {
    expect(percentOf(4, 4)).toBe(100);
    expect(percentOf(0, 4)).toBe(0);
  });
});
