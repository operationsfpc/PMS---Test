import { describe, expect, it } from "vitest";
import {
  countDistinctApplicants,
  countDistinctEvents,
  groupByVisitKey,
  groupDrivesByEvent,
  isStandaloneVisit,
  resolveEffectiveCampuses,
  visitKey,
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
        { driveId: "role-3", companyDriveId: null, title: "Dev" },
      ];
      const groups = groupDrivesByEvent(drives);
      expect(groups.size).toBe(2);
      expect(groups.get("event-1")).toHaveLength(2);
      expect(groups.get("standalone:role-3")).toHaveLength(1);
    });

    /**
     * A legacy drive is keyed by its own id, which is the same namespace as
     * another drive's event id. Without the prefix the two would merge into one
     * card for a company visit that never happened.
     */
    it("never reads a legacy drive's own id as somebody else's event", () => {
      const groups = groupDrivesByEvent([
        { driveId: "d-1", companyDriveId: "d-2" },
        { driveId: "d-2", companyDriveId: null },
      ]);

      expect(groups.size).toBe(2);
      expect(groups.get("d-2")).toEqual([{ driveId: "d-1", companyDriveId: "d-2" }]);
      expect(groups.get("standalone:d-2")).toEqual([{ driveId: "d-2", companyDriveId: null }]);
    });

    it("counts the same visits it groups", () => {
      const drives = [
        { driveId: "role-1", companyDriveId: "event-1" },
        { driveId: "role-2", companyDriveId: "event-1" },
        { driveId: "role-3", companyDriveId: null },
      ];

      expect(groupDrivesByEvent(drives).size).toBe(countDistinctEvents(drives));
    });
  });

  describe("groupByVisitKey", () => {
    /** Rows that are applications, not drives, reach the same grouping. */
    it("groups rows the caller keys itself", () => {
      const rows = [
        { applicationId: "a-1", companyDriveId: "event-1" },
        { applicationId: "a-2", companyDriveId: null },
        { applicationId: "a-3", companyDriveId: "event-1" },
      ];
      const groups = groupByVisitKey(rows, (row) =>
        visitKey(row.companyDriveId, row.applicationId),
      );

      expect([...groups.keys()]).toEqual(["event-1", "standalone:a-2"]);
      expect(isStandaloneVisit("event-1")).toBe(false);
      expect(isStandaloneVisit("standalone:a-2")).toBe(true);
    });
  });
});
