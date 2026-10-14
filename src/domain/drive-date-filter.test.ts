import { describe, expect, it } from "vitest";
import {
  type DateRangeFilterCriteria,
  type DriveDateFilterItem,
  exportDrivesAnalysisCsv,
  extractDateOnly,
  filterDrivesByDateRange,
  getDateRangeForPreset,
  summariseDriveAnalytics,
  toYmd,
} from "./drive-date-filter";

describe("drive-date-filter", () => {
  const sampleDrives: DriveDateFilterItem[] = [
    {
      driveId: "d1",
      companyName: "Acme Corp",
      roleTitle: "Software Engineer",
      status: "live",
      driveType: "placement",
      ctcMinLpa: 8,
      ctcMaxLpa: 12,
      openings: 5,
      createdAt: "2026-10-10T10:00:00Z",
      tentativeDate: "2026-10-25",
      applicants: [
        { shortlisted: true, hasOffer: false },
        { shortlisted: true, hasOffer: true },
        { shortlisted: false, hasOffer: false },
      ],
    },
    {
      driveId: "d2",
      companyName: "Acme Corp",
      roleTitle: "QA Engineer",
      status: "in_rounds",
      driveType: "placement",
      ctcMinLpa: 5,
      ctcMaxLpa: 7,
      openings: 2,
      createdAt: "2026-10-12T11:00:00Z",
      tentativeDate: "2026-10-28",
      applicants: [{ shortlisted: true, hasOffer: false }],
    },
    {
      driveId: "d3",
      companyName: "Beta Labs",
      roleTitle: "Product Intern",
      status: "draft",
      driveType: "internship",
      ctcMinLpa: null,
      ctcMaxLpa: 4,
      openings: 10,
      createdAt: "2026-09-15T08:00:00Z",
      tentativeDate: "2026-11-05",
      applicants: [],
    },
    {
      driveId: "d4",
      companyName: "Gamma Systems",
      roleTitle: "DevOps Engineer",
      status: "completed",
      driveType: "placement",
      ctcMinLpa: 10,
      ctcMaxLpa: 16,
      openings: 3,
      createdAt: "2026-10-14T09:30:00Z",
      tentativeDate: "2026-10-14",
      applicants: [{ shortlisted: true, hasOffer: true }],
    },
  ];

  describe("extractDateOnly & toYmd", () => {
    it("extracts YYYY-MM-DD from ISO strings and dates", () => {
      expect(extractDateOnly("2026-10-14T19:00:00.000Z")).toBe("2026-10-14");
      expect(extractDateOnly("2026-10-25")).toBe("2026-10-25");
      expect(extractDateOnly(null)).toBeNull();
      expect(extractDateOnly("")).toBeNull();
    });

    it("formats Date to YYYY-MM-DD", () => {
      const d = new Date(2026, 9, 14); // Note: month index 9 is October
      expect(toYmd(d)).toBe("2026-10-14");
    });
  });

  describe("getDateRangeForPreset", () => {
    const fixedNow = new Date(2026, 9, 14); // 2026-10-14

    it("returns nulls for 'all'", () => {
      expect(getDateRangeForPreset("all", fixedNow)).toEqual({
        startDate: null,
        endDate: null,
      });
    });

    it("returns today for 'today'", () => {
      expect(getDateRangeForPreset("today", fixedNow)).toEqual({
        startDate: "2026-10-14",
        endDate: "2026-10-14",
      });
    });

    it("returns 7 days range for 'last_7_days'", () => {
      expect(getDateRangeForPreset("last_7_days", fixedNow)).toEqual({
        startDate: "2026-10-07",
        endDate: "2026-10-14",
      });
    });

    it("returns 30 days range for 'last_30_days'", () => {
      expect(getDateRangeForPreset("last_30_days", fixedNow)).toEqual({
        startDate: "2026-09-14",
        endDate: "2026-10-14",
      });
    });

    it("returns current month range for 'this_month'", () => {
      expect(getDateRangeForPreset("this_month", fixedNow)).toEqual({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });
    });
  });

  describe("filterDrivesByDateRange", () => {
    it("returns all drives when preset is 'all'", () => {
      const criteria: DateRangeFilterCriteria = {
        dimension: "created_at",
        preset: "all",
        startDate: null,
        endDate: null,
      };
      const filtered = filterDrivesByDateRange(sampleDrives, criteria);
      expect(filtered).toHaveLength(4);
    });

    it("filters by created_at date range", () => {
      const criteria: DateRangeFilterCriteria = {
        dimension: "created_at",
        preset: "custom",
        startDate: "2026-10-01",
        endDate: "2026-10-13",
      };
      const filtered = filterDrivesByDateRange(sampleDrives, criteria);
      expect(filtered.map((d) => d.driveId)).toEqual(["d1", "d2"]);
    });

    it("filters by tentative_date range", () => {
      const criteria: DateRangeFilterCriteria = {
        dimension: "tentative_date",
        preset: "custom",
        startDate: "2026-10-20",
        endDate: "2026-10-30",
      };
      const filtered = filterDrivesByDateRange(sampleDrives, criteria);
      expect(filtered.map((d) => d.driveId)).toEqual(["d1", "d2"]);
    });
  });

  describe("summariseDriveAnalytics", () => {
    it("computes accurate volume, openings, CTC, and funnel conversions", () => {
      const summary = summariseDriveAnalytics(sampleDrives);

      expect(summary.totalDrives).toBe(4);
      // Acme Corp (2 drives), Beta Labs, Gamma Systems = 3 unique companies
      expect(summary.uniqueCompanies).toBe(3);
      // Openings: 5 + 2 + 10 + 3 = 20
      expect(summary.totalOpenings).toBe(20);
      // CTC Max: 12, 7, 4, 16 => sum=39, count=4, avg=9.75
      expect(summary.avgCtcMaxLpa).toBe(9.75);
      expect(summary.highestCtcMaxLpa).toBe(16);

      // Applicants: 3 + 1 + 0 + 1 = 5
      expect(summary.totalApplicants).toBe(5);
      // Shortlisted: 2 (d1) + 1 (d2) + 0 (d3) + 1 (d4) = 4
      expect(summary.totalShortlisted).toBe(4);
      // Offers: 1 (d1) + 0 (d2) + 0 (d3) + 1 (d4) = 2
      expect(summary.totalOffers).toBe(2);

      expect(summary.byStatus).toEqual({
        live: 1,
        in_rounds: 1,
        draft: 1,
        completed: 1,
      });
    });

    it("handles empty drives list gracefully", () => {
      const summary = summariseDriveAnalytics([]);
      expect(summary.totalDrives).toBe(0);
      expect(summary.uniqueCompanies).toBe(0);
      expect(summary.totalOpenings).toBe(0);
      expect(summary.avgCtcMaxLpa).toBeNull();
      expect(summary.highestCtcMaxLpa).toBeNull();
      expect(summary.totalApplicants).toBe(0);
    });
  });

  describe("exportDrivesAnalysisCsv", () => {
    it("produces valid CSV formatted lines", () => {
      const csv = exportDrivesAnalysisCsv(sampleDrives);
      const lines = csv.split("\r\n");

      expect(lines[0]).toContain("Drive ID,Company Name,Role Title");
      expect(lines[1]).toContain('"d1","Acme Corp","Software Engineer"');
      expect(lines[2]).toContain('"d2","Acme Corp","QA Engineer"');
      expect(lines).toHaveLength(5); // 1 header + 4 drives
    });
  });
});
