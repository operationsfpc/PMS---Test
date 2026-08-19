import { describe, expect, it } from "vitest";
import { describeCtcRange } from "./ctc";

/** C3 (UAT 2026-08-19): the identifier that tells two same-company drives apart. */
describe("describeCtcRange", () => {
  it("formats a range", () => {
    expect(describeCtcRange(3, 3.5)).toBe("₹3–3.5 LPA");
  });

  it("formats a single figure when only the minimum is declared", () => {
    expect(describeCtcRange(4, null)).toBe("₹4 LPA");
  });

  it("collapses an equal min and max to one figure", () => {
    expect(describeCtcRange(5, 5)).toBe("₹5 LPA");
  });

  it("formats a lone maximum rather than inventing a minimum", () => {
    expect(describeCtcRange(null, 6)).toBe("₹6 LPA");
  });

  it("returns null when nothing is declared — a dash is the screen's choice", () => {
    expect(describeCtcRange(null, null)).toBeNull();
  });
});
