import { describe, expect, it } from "vitest";
import { describeStipendRange, hasAnyPay } from "./stipend";

/**
 * Karthik, 2026-08-27: "while approving internship PIF, stipend mentioned has
 * to be shown to delivery head. this is currently missing."
 *
 * The sibling of `describeCtcRange` (C3), and here for the same reason: one
 * formatter, so a stipend never reads two ways on two screens.
 *
 * Grouped the Indian way. ₹1,50,000 and ₹150,000 are the same number and are
 * NOT read at the same speed by the person approving it.
 */
describe("describeStipendRange", () => {
  it("reads a range", () => {
    expect(describeStipendRange(15000, 20000)).toBe("₹15,000–20,000 / month");
  });

  it("reads a single figure when there is no ceiling", () => {
    expect(describeStipendRange(15000, null)).toBe("₹15,000 / month");
  });

  it("reads a single figure when the floor and the ceiling are the same", () => {
    expect(describeStipendRange(15000, 15000)).toBe("₹15,000 / month");
  });

  it("reads a ceiling given without a floor rather than printing null", () => {
    expect(describeStipendRange(null, 20000)).toBe("₹20,000 / month");
  });

  it("groups lakhs the Indian way", () => {
    expect(describeStipendRange(150000, null)).toBe("₹1,50,000 / month");
  });

  it("says nothing at all when no stipend was recorded", () => {
    expect(describeStipendRange(null, null)).toBeNull();
  });

  /** A stipend of zero is not a stipend; it is a blank someone typed into. */
  it("treats zero as no stipend rather than as free labour", () => {
    expect(describeStipendRange(0, 0)).toBeNull();
  });
});

/**
 * P10 (answer 8, 2026-08-27): "a drive must record what it pays". One
 * predicate, so the go-live gate and the screens cannot disagree about
 * whether a drive has told anyone what the job is worth.
 */
describe("hasAnyPay", () => {
  it("is satisfied by a CTC alone", () => {
    expect(hasAnyPay(6, null, null)).toBe(true);
  });

  it("is satisfied by a stipend alone", () => {
    expect(hasAnyPay(null, 15000, null)).toBe(true);
    expect(hasAnyPay(null, null, 20000)).toBe(true);
  });

  it("is not satisfied by silence, or by a zero somebody typed in", () => {
    expect(hasAnyPay(null, null, null)).toBe(false);
    expect(hasAnyPay(null, 0, 0)).toBe(false);
  });
});
