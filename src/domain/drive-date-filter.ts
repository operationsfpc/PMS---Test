/**
 * Filtering drives by date range (Creation date vs Drive / Tentative date)
 * and aggregating recruiting metrics for monitoring & analysis.
 */

import type { DriveStatus, DriveType } from "./types";

export type DateDimension = "created_at" | "tentative_date";

export type DateRangePreset =
  | "all"
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "custom";

export interface DateRangeFilterCriteria {
  readonly dimension: DateDimension;
  readonly preset: DateRangePreset;
  readonly startDate: string | null; // "YYYY-MM-DD"
  readonly endDate: string | null; // "YYYY-MM-DD"
}

export interface DriveDateFilterItem {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly status: DriveStatus;
  readonly driveType?: DriveType | null;
  readonly ctcMinLpa?: number | null;
  readonly ctcMaxLpa?: number | null;
  readonly openings?: number | null;
  readonly createdAt: string | null; // ISO string
  readonly tentativeDate?: string | null; // YYYY-MM-DD or ISO string
  readonly applicants?: readonly {
    readonly shortlisted: boolean;
    readonly hasOffer: boolean;
  }[];
}

export interface DriveAnalyticsSummary {
  readonly totalDrives: number;
  readonly uniqueCompanies: number;
  readonly totalOpenings: number;
  readonly avgCtcMaxLpa: number | null;
  readonly highestCtcMaxLpa: number | null;
  readonly totalApplicants: number;
  readonly totalShortlisted: number;
  readonly totalOffers: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

/** Formats a Date object to "YYYY-MM-DD" in local time */
export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Extracts the "YYYY-MM-DD" portion from an ISO string or date string */
export function extractDateOnly(dateValue: string | null | undefined): string | null {
  if (!dateValue || dateValue.trim() === "") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dateValue.trim());
  return match ? (match[1] ?? null) : null;
}

/**
 * Calculates start and end dates (YYYY-MM-DD) for a given preset relative to `now`.
 */
export function getDateRangeForPreset(
  preset: DateRangePreset,
  now: Date = new Date(),
): { startDate: string | null; endDate: string | null } {
  const todayStr = toYmd(now);

  switch (preset) {
    case "all":
      return { startDate: null, endDate: null };
    case "today":
      return { startDate: todayStr, endDate: todayStr };
    case "last_7_days": {
      const past = new Date(now);
      past.setDate(past.getDate() - 7);
      return { startDate: toYmd(past), endDate: todayStr };
    }
    case "last_30_days": {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { startDate: toYmd(past), endDate: todayStr };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: toYmd(start), endDate: toYmd(end) };
    }
    case "custom":
      return { startDate: null, endDate: null };
  }
}

/**
 * Filters drives by date range based on either `createdAt` or `tentativeDate`.
 */
export function filterDrivesByDateRange<T extends DriveDateFilterItem>(
  drives: readonly T[],
  criteria: DateRangeFilterCriteria,
): readonly T[] {
  const { dimension, preset, startDate, endDate } = criteria;

  if (preset === "all" && !startDate && !endDate) {
    return drives;
  }

  return drives.filter((drive) => {
    const rawDate = dimension === "created_at" ? drive.createdAt : drive.tentativeDate;
    const dateYmd = extractDateOnly(rawDate);

    // If drive has no date for the selected dimension, exclude it when a filter is applied
    if (!dateYmd) return false;

    if (startDate && dateYmd < startDate) return false;
    if (endDate && dateYmd > endDate) return false;

    return true;
  });
}

/**
 * Computes recruitment volume, CTC spread, vacancies, and funnel analytics.
 */
export function summariseDriveAnalytics<T extends DriveDateFilterItem>(
  drives: readonly T[],
): DriveAnalyticsSummary {
  const companies = new Set<string>();
  let totalOpenings = 0;
  let ctcSum = 0;
  let ctcCount = 0;
  let highestCtc: number | null = null;
  let totalApplicants = 0;
  let totalShortlisted = 0;
  let totalOffers = 0;
  const byStatus: Record<string, number> = {};

  for (const d of drives) {
    if (d.companyName && d.companyName.trim() !== "") {
      companies.add(d.companyName.trim().toLowerCase());
    }

    if (typeof d.openings === "number" && !Number.isNaN(d.openings) && d.openings > 0) {
      totalOpenings += d.openings;
    }

    if (typeof d.ctcMaxLpa === "number" && !Number.isNaN(d.ctcMaxLpa) && d.ctcMaxLpa > 0) {
      ctcSum += d.ctcMaxLpa;
      ctcCount += 1;
      if (highestCtc === null || d.ctcMaxLpa > highestCtc) {
        highestCtc = d.ctcMaxLpa;
      }
    }

    const appCount = d.applicants?.length ?? 0;
    totalApplicants += appCount;

    if (d.applicants) {
      for (const app of d.applicants) {
        if (app.shortlisted) totalShortlisted += 1;
        if (app.hasOffer) totalOffers += 1;
      }
    }

    const st = d.status ?? "draft";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }

  const avgCtcMaxLpa = ctcCount > 0 ? Math.round((ctcSum / ctcCount) * 100) / 100 : null;

  return {
    totalDrives: drives.length,
    uniqueCompanies: companies.size,
    totalOpenings,
    avgCtcMaxLpa,
    highestCtcMaxLpa: highestCtc,
    totalApplicants,
    totalShortlisted,
    totalOffers,
    byStatus,
  };
}

/**
 * Generates CSV data for date-filtered drives analysis.
 */
export function exportDrivesAnalysisCsv<T extends DriveDateFilterItem>(
  drives: readonly T[],
): string {
  const headers = [
    "Drive ID",
    "Company Name",
    "Role Title",
    "Status",
    "Drive Type",
    "Created Date",
    "Tentative Date",
    "Min CTC (LPA)",
    "Max CTC (LPA)",
    "Openings",
    "Applicants",
    "Shortlisted",
    "Offers",
  ];

  const escapeCell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const str = String(v).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = drives.map((d) => {
    const shortlistedCount = d.applicants?.filter((a) => a.shortlisted).length ?? 0;
    const offerCount = d.applicants?.filter((a) => a.hasOffer).length ?? 0;

    return [
      escapeCell(d.driveId),
      escapeCell(d.companyName),
      escapeCell(d.roleTitle ?? "Not specified"),
      escapeCell(d.status),
      escapeCell(d.driveType ?? ""),
      escapeCell(extractDateOnly(d.createdAt) ?? ""),
      escapeCell(extractDateOnly(d.tentativeDate) ?? ""),
      escapeCell(d.ctcMinLpa ?? ""),
      escapeCell(d.ctcMaxLpa ?? ""),
      escapeCell(d.openings ?? ""),
      escapeCell(d.applicants?.length ?? 0),
      escapeCell(shortlistedCount),
      escapeCell(offerCount),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}
