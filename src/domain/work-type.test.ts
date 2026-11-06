import { describe, expect, it } from "vitest";
import { WORK_TYPES } from "./types";
import { asWorkType, workTypeLabel } from "./work-type";

/**
 * 2026-11-06: "on pif i need new dropdown work type as Hybrid, work from
 * home, work from office … i need that on card".
 *
 * The label lives here because the student's cards, the drive record and the
 * approval queue all show the same three answers, and a role that reads
 * "Work from home" on one screen and "work_from_home" on another is two
 * different jobs to the person comparing them.
 */
describe("workTypeLabel", () => {
  it("names each work type the way it is said out loud", () => {
    expect(workTypeLabel("hybrid")).toBe("Hybrid");
    expect(workTypeLabel("work_from_home")).toBe("Work from home");
    expect(workTypeLabel("work_from_office")).toBe("Work from office");
  });

  it("has a label for every work type there is", () => {
    for (const type of WORK_TYPES) {
      expect(workTypeLabel(type)).not.toBe("");
    }
  });

  it("says so plainly when the AE never answered", () => {
    expect(workTypeLabel(null)).toBe("Not stated");
  });
});

/**
 * The question is optional, so `null` is the common answer rather than a data
 * fault, and every screen holds the column as a plain string. A card decides
 * whether to print by asking this, not by matching on a sentence.
 */
describe("asWorkType", () => {
  it("recognises every declared work type", () => {
    for (const type of WORK_TYPES) {
      expect(asWorkType(type)).toBe(type);
    }
  });

  it("answers null for anything that is not a work type", () => {
    expect(asWorkType("")).toBeNull();
    expect(asWorkType("remote")).toBeNull();
    expect(asWorkType("Work from home")).toBeNull();
    expect(asWorkType(null)).toBeNull();
    expect(asWorkType(undefined)).toBeNull();
  });
});
