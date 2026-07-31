import { describe, expect, it } from "vitest";
import {
  isConsistentArrears,
  isValidArrearCount,
  isValidCgpa,
  isValidIndianMobile,
  isValidPassingYear,
  isValidPercentage,
  missingResumesFor,
} from "./srf-rules";

describe("isValidPercentage", () => {
  it.each([0, 45.5, 100])("accepts %s", (v) => expect(isValidPercentage(v)).toBe(true));
  it.each([-0.1, 100.1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (v) =>
    expect(isValidPercentage(v)).toBe(false),
  );
});

describe("isValidCgpa", () => {
  it.each([0, 8.24, 10])("accepts %s", (v) => expect(isValidCgpa(v)).toBe(true));
  it.each([-1, 10.01, Number.NaN])("rejects %s", (v) => expect(isValidCgpa(v)).toBe(false));

  it("rejects a percentage entered into the CGPA box", () => {
    // The most common data-entry error in campus systems.
    expect(isValidCgpa(82.4)).toBe(false);
  });
});

describe("isValidIndianMobile", () => {
  it.each(["9876543210", "6000000000"])("accepts %s", (v) =>
    expect(isValidIndianMobile(v)).toBe(true),
  );
  it.each(["5876543210", "987654321", "98765432100", "+919876543210", "98765 43210", ""])(
    "rejects %s",
    (v) => expect(isValidIndianMobile(v)).toBe(false),
  );
});

describe("isValidArrearCount", () => {
  it.each([0, 3])("accepts %s", (v) => expect(isValidArrearCount(v)).toBe(true));
  it.each([-1, 1.5, Number.NaN])("rejects %s", (v) => expect(isValidArrearCount(v)).toBe(false));
});

describe("isConsistentArrears", () => {
  it("accepts history equal to current", () => {
    expect(isConsistentArrears(2, 2)).toBe(true);
  });

  it("accepts history greater than current — backlogs were cleared", () => {
    expect(isConsistentArrears(1, 4)).toBe(true);
  });

  it("rejects history lower than current, which is impossible", () => {
    // A standing arrear is necessarily part of the history.
    expect(isConsistentArrears(3, 1)).toBe(false);
  });

  it("accepts a clean record", () => {
    expect(isConsistentArrears(0, 0)).toBe(true);
  });
});

describe("isValidPassingYear", () => {
  const now = new Date("2026-07-31T00:00:00Z");

  it.each([2026, 2027, 2021, 2032])("accepts %s", (y) =>
    expect(isValidPassingYear(y, now)).toBe(true),
  );
  it.each([2020, 2033, 202, 2026.5])("rejects %s", (y) =>
    expect(isValidPassingYear(y, now)).toBe(false),
  );
});

describe("missingResumesFor", () => {
  it("reports nothing when every selected category has a resume", () => {
    expect(missingResumesFor(["sales"], ["sales"])).toEqual([]);
  });

  it("reports each category still missing a resume", () => {
    expect(missingResumesFor(["sales", "software_technical"], ["sales"])).toEqual([
      "software_technical",
    ]);
  });

  it("ignores resumes uploaded for categories no longer selected", () => {
    expect(missingResumesFor(["sales"], ["sales", "digital_marketing"])).toEqual([]);
  });

  it("reports everything when nothing has been uploaded", () => {
    expect(missingResumesFor(["sales", "digital_marketing"], [])).toEqual([
      "sales",
      "digital_marketing",
    ]);
  });
});
