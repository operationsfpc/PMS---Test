import { describe, expect, it } from "vitest";
import { percentOf, roundMoney, roundPercent, roundTo, sameMoney } from "./math";

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

/**
 * CLAUDE.md: never compare money with floating-point equality.
 *
 * Added 2026-08-26 for the package figures on the placement overview, which
 * link to "the students holding exactly this CTC". `6.5 === 6.5` happens to
 * hold; `0.1 + 0.2 === 0.3` does not, and the difference between the two is
 * invisible in the data that produced them.
 */
describe("sameMoney", () => {
  it("is true for figures that are equal to the paisa", () => {
    expect(sameMoney(6.5, 6.5)).toBe(true);
    expect(sameMoney(12, 12.0)).toBe(true);
  });

  it("is true for figures a float has quietly mangled", () => {
    expect(sameMoney(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameMoney(4.8 * 3, 14.4)).toBe(true);
  });

  it("is false for figures that genuinely differ", () => {
    expect(sameMoney(6.5, 6.51)).toBe(false);
    expect(sameMoney(4.8, 5)).toBe(false);
  });

  /** A tolerance wide enough to swallow a real difference is not a tolerance. */
  it("does not swallow a paisa", () => {
    expect(sameMoney(6.5, 6.505)).toBe(false);
  });
});
