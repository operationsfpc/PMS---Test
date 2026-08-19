import { describe, expect, it } from "vitest";
import {
  CLOSING_FILTERS,
  classifyStudentDrive,
  closesWithin,
  describeTimeLeft,
  matchesLocation,
  parseLocations,
  STUDENT_DRIVE_LISTS,
} from "./student-drive-lists";

/**
 * N7 (spec 2026-08-18, approved; mockup approved 2026-08-19) — the student's
 * Drives area is four lists, and a drive is in EXACTLY one of them:
 *
 *   to_apply            live, window open, not applied
 *   in_progress         applied, not yet concluded for them
 *   not_applied_closed  never applied, and the chance has gone
 *   applied_closed      applied, and it concluded — completed drive, or a
 *                       terminal outcome for them (selected / not selected)
 */

const now = new Date("2026-08-20T12:00:00Z");
const future = new Date("2026-08-24T17:00:00Z");
const past = new Date("2026-08-12T17:00:00Z");

describe("classifyStudentDrive", () => {
  it("names all four lists, once each", () => {
    expect(STUDENT_DRIVE_LISTS).toEqual([
      "to_apply",
      "in_progress",
      "not_applied_closed",
      "applied_closed",
    ]);
  });

  it("puts a live drive with an open window, not applied, in To apply", () => {
    expect(
      classifyStudentDrive(
        { applied: false, driveStatus: "live", applicationEnd: future, stage: null },
        now,
      ),
    ).toBe("to_apply");
  });

  it("moves a live drive whose window closed, never applied, to Not applied", () => {
    expect(
      classifyStudentDrive(
        { applied: false, driveStatus: "live", applicationEnd: past, stage: null },
        now,
      ),
    ).toBe("not_applied_closed");
  });

  it("a drive past live status, never applied, is Not applied — the chance has gone", () => {
    for (const driveStatus of ["applications_closed", "in_rounds", "completed"] as const) {
      expect(
        classifyStudentDrive(
          { applied: false, driveStatus, applicationEnd: past, stage: null },
          now,
        ),
      ).toBe("not_applied_closed");
    }
  });

  it("an application still being decided is In progress, whatever the drive status", () => {
    for (const stage of ["applied", "in_process"] as const) {
      expect(
        classifyStudentDrive(
          { applied: true, driveStatus: "in_rounds", applicationEnd: past, stage },
          now,
        ),
      ).toBe("in_progress");
    }
  });

  it("a terminal outcome is Applied-closed, even while the drive itself runs on", () => {
    for (const stage of ["selected", "not_selected"] as const) {
      expect(
        classifyStudentDrive(
          { applied: true, driveStatus: "in_rounds", applicationEnd: past, stage },
          now,
        ),
      ).toBe("applied_closed");
    }
  });

  it("a completed drive is Applied-closed for its applicants regardless of stage", () => {
    expect(
      classifyStudentDrive(
        { applied: true, driveStatus: "completed", applicationEnd: past, stage: "in_process" },
        now,
      ),
    ).toBe("applied_closed");
  });
});

describe("describeTimeLeft", () => {
  it("counts whole days when more than two remain", () => {
    expect(describeTimeLeft(new Date("2026-08-24T17:00:00Z"), now)).toEqual({
      label: "4 days left to apply",
      urgent: false,
    });
  });

  it("switches to hours inside two days, urgent inside 24", () => {
    expect(describeTimeLeft(new Date("2026-08-21T18:00:00Z"), now)).toEqual({
      label: "30 hours left to apply",
      urgent: false,
    });
    expect(describeTimeLeft(new Date("2026-08-20T18:00:00Z"), now)).toEqual({
      label: "6 hours left to apply",
      urgent: true,
    });
  });

  it("speaks singular at exactly one hour", () => {
    expect(describeTimeLeft(new Date("2026-08-20T13:30:00Z"), now)).toEqual({
      label: "1 hour left to apply",
      urgent: true,
    });
  });

  it("counts minutes inside the final hour, never saying '0 minutes'", () => {
    expect(describeTimeLeft(new Date("2026-08-20T12:40:00Z"), now)).toEqual({
      label: "40 minutes left to apply",
      urgent: true,
    });
    expect(describeTimeLeft(new Date("2026-08-20T12:00:20Z"), now)).toEqual({
      label: "1 minute left to apply",
      urgent: true,
    });
  });

  it("says closed once the moment has passed", () => {
    expect(describeTimeLeft(past, now)).toEqual({ label: "Applications closed", urgent: false });
  });
});

describe("closesWithin", () => {
  it("carries the four options", () => {
    expect(CLOSING_FILTERS).toEqual(["any", "today", "3_days", "7_days"]);
  });

  it("'any' admits everything still open, and nothing closed", () => {
    expect(closesWithin(future, now, "any")).toBe(true);
    expect(closesWithin(past, now, "any")).toBe(false);
  });

  it("bounds each option by its horizon", () => {
    const in6Hours = new Date("2026-08-20T18:00:00Z");
    const in2Days = new Date("2026-08-22T12:00:00Z");
    const in6Days = new Date("2026-08-26T12:00:00Z");

    expect(closesWithin(in6Hours, now, "today")).toBe(true);
    expect(closesWithin(in2Days, now, "today")).toBe(false);
    expect(closesWithin(in2Days, now, "3_days")).toBe(true);
    expect(closesWithin(in6Days, now, "3_days")).toBe(false);
    expect(closesWithin(in6Days, now, "7_days")).toBe(true);
  });
});

describe("location matching", () => {
  it("splits a free-text location list on commas, trimmed, empties dropped", () => {
    expect(parseLocations("Bengaluru, Chennai , Hyderabad,,")).toEqual([
      "Bengaluru",
      "Chennai",
      "Hyderabad",
    ]);
    expect(parseLocations("")).toEqual([]);
  });

  it("matches case-insensitively, and an empty filter matches everything", () => {
    expect(matchesLocation("Bengaluru, Chennai", "chennai")).toBe(true);
    expect(matchesLocation("Bengaluru, Chennai", "Pune")).toBe(false);
    expect(matchesLocation("Bengaluru, Chennai", "")).toBe(true);
    expect(matchesLocation("", "")).toBe(true);
  });
});
