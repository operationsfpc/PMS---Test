import { describe, expect, it } from "vitest";
import {
  countDistinctApplicants,
  countDistinctEvents,
  groupDrivesByEvent,
  resolveEffectiveCampuses,
} from "./company-drive";

describe("company-drive domain", () => {
  describe("resolveEffectiveCampuses", () => {
    it("inherits event defaults when role has no custom targeting", () => {
      const result = resolveEffectiveCampuses(false, ["campus-special"], ["campus-1", "campus-2"]);
      expect(result).toEqual(["campus-1", "campus-2"]);
    });

    it("uses role overrides when role has custom targeting", () => {
      const result = resolveEffectiveCampuses(true, ["campus-special"], ["campus-1", "campus-2"]);
      expect(result).toEqual(["campus-special"]);
    });

    it("allows role to explicitly target empty campuses when custom targeting is on", () => {
      const result = resolveEffectiveCampuses(true, [], ["campus-1", "campus-2"]);
      expect(result).toEqual([]);
    });
  });

  describe("countDistinctEvents", () => {
    it("groups drives with the same companyDriveId into one event", () => {
      const drives = [
        { driveId: "role-1", companyDriveId: "event-a" },
        { driveId: "role-2", companyDriveId: "event-a" },
        { driveId: "role-3", companyDriveId: "event-b" },
      ];
      expect(countDistinctEvents(drives)).toBe(2);
    });

    it("treats each standalone legacy drive as its own event", () => {
      const drives = [
        { driveId: "role-1", companyDriveId: "event-a" },
        { driveId: "role-2", companyDriveId: "event-a" },
        { driveId: "legacy-1", companyDriveId: null },
        { driveId: "legacy-2", companyDriveId: null },
      ];
      expect(countDistinctEvents(drives)).toBe(3); // event-a, legacy-1, legacy-2
    });
  });

  describe("countDistinctApplicants", () => {
    it("counts unique students across multiple role applications", () => {
      const applications = [
        { studentId: "student-1" },
        { studentId: "student-1" }, // applied to role 2 as well
        { studentId: "student-2" },
      ];
      expect(countDistinctApplicants(applications)).toBe(2);
    });
  });

  describe("groupDrivesByEvent", () => {
    it("groups drives under their event or standalone key", () => {
      const drives = [
        { driveId: "role-1", companyDriveId: "event-1", title: "SDE" },
        { driveId: "role-2", companyDriveId: "event-1", title: "QA" },
        { driveId: "standalone-1", companyDriveId: null, title: "Dev" },
      ];
      const groups = groupDrivesByEvent(drives);
      expect(groups.size).toBe(2);
      expect(groups.get("event-1")).toHaveLength(2);
      expect(groups.get("standalone-1")).toHaveLength(1);
    });
  });
});
