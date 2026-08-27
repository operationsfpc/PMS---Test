import { describe, expect, it } from "vitest";
import {
  asDriveTypeFilter,
  DRIVE_TYPE_FILTERS,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "./drive-type";
import { DRIVE_TYPES } from "./types";

/**
 * Karthik, 2026-08-27: "show a small tag on the type (Internship / Internship
 * convertible to FT / Full Time)" and "add a filter on top of this page to
 * select drives of a particular type".
 *
 * One label and one predicate, in the domain, because five screens show this
 * and a drive that reads "Full time" on one and "placement" on another is two
 * drives to the person reading them.
 */
describe("driveTypeLabel", () => {
  it("names each type the way the business says it out loud", () => {
    expect(driveTypeLabel("placement")).toBe("Full time");
    expect(driveTypeLabel("internship_convertible")).toBe("Internship → Full time");
    expect(driveTypeLabel("internship")).toBe("Internship");
  });

  it("has a label for every type there is", () => {
    for (const type of DRIVE_TYPES) {
      expect(driveTypeLabel(type)).not.toBe("");
    }
  });

  it("says so plainly when a drive never declared a type", () => {
    expect(driveTypeLabel(null)).toBe("Type not set");
  });
});

describe("driveTypeTone", () => {
  it("gives each type its own tag colour, and a quiet one to the default case", () => {
    expect(driveTypeTone("placement")).toBe("neutral");
    expect(driveTypeTone("internship_convertible")).toBe("accent");
    expect(driveTypeTone("internship")).toBe("warning");
    expect(driveTypeTone(null)).toBe("neutral");
  });
});

/**
 * The filter is a domain predicate, not an inline `filter`, for the same
 * reason `searchDrives` is: five screens must agree about what "Internship"
 * contains, or a coordinator who filters and sees nothing concludes the drive
 * is gone.
 */
describe("matchesDriveType", () => {
  it("matches everything when nothing is selected", () => {
    expect(matchesDriveType("placement", "")).toBe(true);
    expect(matchesDriveType("internship", "")).toBe(true);
    expect(matchesDriveType(null, "")).toBe(true);
  });

  it("matches only the selected type", () => {
    expect(matchesDriveType("internship", "internship")).toBe(true);
    expect(matchesDriveType("internship_convertible", "internship")).toBe(false);
    expect(matchesDriveType("placement", "internship")).toBe(false);
  });

  it("never lets a drive with no type masquerade as one that has it", () => {
    expect(matchesDriveType(null, "placement")).toBe(false);
  });

  it("keeps convertible separate from both neighbours \u2014 it is its own thing", () => {
    expect(matchesDriveType("internship_convertible", "internship_convertible")).toBe(true);
    expect(matchesDriveType("internship_convertible", "placement")).toBe(false);
  });
});

describe("DRIVE_TYPE_FILTERS", () => {
  it("offers All first, then every type in the order the business ranks them", () => {
    expect(DRIVE_TYPE_FILTERS.map((f) => f.value)).toEqual([
      "",
      "placement",
      "internship_convertible",
      "internship",
    ]);
    expect(DRIVE_TYPE_FILTERS[0]?.label).toBe("All");
    expect(DRIVE_TYPE_FILTERS[1]?.label).toBe("Full time");
  });
});

describe("asDriveTypeFilter", () => {
  it("narrows what a URL can carry, defaulting to All", () => {
    expect(asDriveTypeFilter("internship")).toBe("internship");
    expect(asDriveTypeFilter("nonsense")).toBe("");
    expect(asDriveTypeFilter(null)).toBe("");
    expect(asDriveTypeFilter(undefined)).toBe("");
  });
});
