import { describe, expect, it } from "vitest";
import {
  companyVisitKey,
  countDistinctApplicants,
  countDistinctEvents,
  groupByCompanyVisit,
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

    /**
     * 0118 gave every legacy drive its own event row, so the same company
     * raised twice for one visit arrives with two event ids. Counting the ids
     * says two visits where the reader sees one.
     */
    it("counts one visit when the company and day match across event ids", () => {
      const drives = [
        {
          driveId: "role-1",
          companyDriveId: "event-a",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
        {
          driveId: "role-2",
          companyDriveId: "event-b",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
      ];
      expect(countDistinctEvents(drives)).toBe(1);
    });

    it("keeps the same company on different days as separate visits", () => {
      const drives = [
        {
          driveId: "role-1",
          companyDriveId: "event-a",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
        {
          driveId: "role-2",
          companyDriveId: "event-b",
          companyName: "TCS",
          tentativeDate: "2026-11-12",
        },
      ];
      expect(countDistinctEvents(drives)).toBe(2);
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

    it("folds separately raised drives of one visit into one card", () => {
      const drives = [
        {
          driveId: "role-1",
          companyDriveId: "event-a",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
        {
          driveId: "role-2",
          companyDriveId: "event-b",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
        {
          driveId: "role-3",
          companyDriveId: null,
          companyName: "Infosys",
          tentativeDate: "2026-11-05",
        },
      ];

      const groups = groupDrivesByEvent(drives);
      expect(groups.size).toBe(2);
      expect(groups.get("visit:tcs|2026-11-05")).toHaveLength(2);
      expect(groups.get("visit:infosys|2026-11-05")).toHaveLength(1);
      expect(groups.size).toBe(countDistinctEvents(drives));
    });

    it("falls back to the event key when the day is missing", () => {
      const drives = [
        { driveId: "role-1", companyDriveId: "event-a", companyName: "TCS", tentativeDate: null },
        { driveId: "role-2", companyDriveId: "event-b", companyName: "TCS", tentativeDate: "" },
      ];

      const groups = groupDrivesByEvent(drives);
      expect([...groups.keys()]).toEqual(["event-a", "event-b"]);
    });

    /**
     * A role that forgot its date must not fall out of its own event: the
     * sibling that did state the day names the visit for both.
     */
    it("keeps an event's roles together when only one of them states the day", () => {
      const drives = [
        {
          driveId: "role-1",
          companyDriveId: "event-a",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
        { driveId: "role-2", companyDriveId: "event-a", companyName: "TCS", tentativeDate: null },
        {
          driveId: "role-3",
          companyDriveId: "event-b",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        },
      ];

      const groups = groupDrivesByEvent(drives);
      expect(groups.size).toBe(1);
      expect(groups.get("visit:tcs|2026-11-05")).toHaveLength(3);
    });
  });

  describe("companyVisitKey", () => {
    it("names the company and day it was given", () => {
      expect(
        companyVisitKey({
          ownId: "role-1",
          companyName: "TCS",
          tentativeDate: "2026-11-05",
        }),
      ).toBe("visit:tcs|2026-11-05");
    });

    it("reads a timestamp as its day", () => {
      expect(
        companyVisitKey({
          ownId: "role-1",
          companyName: "TCS",
          tentativeDate: "2026-11-05T09:30:00.000Z",
        }),
      ).toBe("visit:tcs|2026-11-05");
    });

    it("ignores case and extra spacing in the company name", () => {
      expect(
        companyVisitKey({
          ownId: "a",
          companyName: "  Tata   Consultancy  ",
          tentativeDate: "2026-11-05",
        }),
      ).toBe(
        companyVisitKey({
          ownId: "b",
          companyName: "tata consultancy",
          tentativeDate: "2026-11-05",
        }),
      );
    });

    it("falls back to the event key without a company", () => {
      expect(
        companyVisitKey({
          ownId: "role-1",
          companyDriveId: "event-a",
          tentativeDate: "2026-11-05",
        }),
      ).toBe("event-a");
    });

    it("never collides a visit key with a real event id", () => {
      expect(
        isStandaloneVisit(
          companyVisitKey({ ownId: "a", companyName: "TCS", tentativeDate: "2026-11-05" }),
        ),
      ).toBe(false);
    });
  });

  describe("groupByCompanyVisit", () => {
    it("groups rows that each name their own company and day", () => {
      const applications = [
        { applicationId: "a-1", companyName: "TCS", tentativeDate: "2026-11-05" },
        { applicationId: "a-2", companyName: "TCS", tentativeDate: "2026-11-05" },
        { applicationId: "a-3", companyName: "Infosys", tentativeDate: "2026-11-05" },
      ];

      const groups = groupByCompanyVisit(applications, (row) => ({
        ownId: row.applicationId,
        companyName: row.companyName,
        tentativeDate: row.tentativeDate,
      }));

      expect([...groups.keys()]).toEqual(["visit:tcs|2026-11-05", "visit:infosys|2026-11-05"]);
      expect(groups.get("visit:tcs|2026-11-05")).toHaveLength(2);
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
