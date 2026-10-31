import { driveTypeLabel } from "@domain/drive-type";
import { DRIVE_TYPES } from "@domain/types";

/**
 * Label maps and small helpers shared by both PIF forms and the AE screens
 * that print PIF-derived facts. Everything here is data, not behaviour.
 */

/**
 * The AE's sections, in the order the ONE PIF asks them (UAT 2026-08-19 A1/A3):
 * who the company is and when it is coming, the bar it sets for the visit, then
 * each role. Drive type and compensation are per role now — a placement role
 * and an internship role can belong to the same visit — so the type is the
 * first question INSIDE each role block rather than a section of its own.
 *
 * The eligibility bar sits ABOVE the roles on purpose: a company that wants a
 * 7.5 CGPA wants it for every role it hires for that day, and asking it once
 * per role is how one visit ends up with two different bars for one recruiter.
 */
export const PIF_SECTIONS = [
  { id: "company", short: "Company", title: "Company details" },
  { id: "event", short: "Drive day", title: "Drive day, mode and joining" },
  { id: "eligibility", short: "Eligibility", title: "Eligibility and bond" },
] as const;

/** The heading over the repeatable role blocks, and its one-line explanation. */
export const ROLES_SECTION = {
  id: "roles",
  title: "Roles under this drive",
  detail:
    "Each role is approved with the drive above. Raise roles with SEPARATE interview processes on separate PIFs.",
} as const;

export const ROLE_CATEGORY_LABELS: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

export const DRIVE_MODE_LABELS: Record<string, string> = {
  on_campus: "On-campus",
  physical_outside_campus: "Physical drive outside campus",
  virtual: "Virtual",
  pooled: "Pooled drive",
};

/**
 * 2026-08-27: one spelling, from the domain. This map said "Placement" and
 * "Internship (convertible)" while the publish view printed "internship
 * convertible" and the cards printed the raw value — four spellings of three
 * things.
 */
export const DRIVE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DRIVE_TYPES.map((type) => [type, driveTypeLabel(type)]),
);

export const ARREAR_LABELS: Record<string, string> = {
  flexible: "Flexible — arrears allowed",
  no_standing: "No standing arrears",
  no_history: "No arrear history at all",
};

export const PASSING_YEARS = [2026, 2027, 2028] as const;

/** F12: recruiters state the bar the way their own HR does. */
export const SCALE_LABELS: Record<string, string> = {
  cgpa: "CGPA (out of 10)",
  percentage: "Percentage (out of 100)",
};

/** A contact as the form and the event picker both hold it — every part optional. */
export interface ContactRow {
  name?: string | undefined;
  designation?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
}

export const contactSignature = (rows: readonly ContactRow[] | undefined) =>
  JSON.stringify(
    (rows ?? []).map((c) => [c?.name ?? "", c?.designation ?? "", c?.email ?? "", c?.phone ?? ""]),
  );

export const hasAnyContactIn = (rows: readonly ContactRow[] | undefined) =>
  (rows ?? []).some((c) =>
    [c?.name, c?.designation, c?.email, c?.phone].some(
      (f) => typeof f === "string" && f.trim() !== "",
    ),
  );

/**
 * The eligibility bar as one company states it for one visit: the bond, the
 * cutoff and the years a student may apply in.
 */
export interface BarRow {
  bondDetails?: string | undefined;
  minOverallCgpa?: number | null | undefined;
  minOverallCgpaScale?: string | undefined;
  minTenthPercentage?: number | null | undefined;
  minTwelfthPercentage?: number | null | undefined;
  arrearsPolicy?: string | undefined;
  eligiblePassingYears?: readonly (number | string)[] | undefined;
}

/** Two bars are the same answer when they say the same thing. */
export const barSignature = (bar: BarRow | undefined) =>
  JSON.stringify([
    bar?.bondDetails ?? "",
    bar?.minOverallCgpa ?? "",
    bar?.minOverallCgpaScale ?? "",
    bar?.minTenthPercentage ?? "",
    bar?.minTwelfthPercentage ?? "",
    bar?.arrearsPolicy ?? "",
    (bar?.eligiblePassingYears ?? []).join(","),
  ]);

/**
 * Whether the AE has actually answered anything.
 *
 * The scale and the arrear policy have defaults, so they are NOT answers —
 * counting them would make every fresh form look answered and stop the bar
 * from ever being prefilled from the visit it belongs to.
 */
export const hasAnyBarIn = (bar: BarRow | undefined) =>
  [bar?.bondDetails, bar?.minOverallCgpa, bar?.minTenthPercentage, bar?.minTwelfthPercentage].some(
    (f) => f !== undefined && f !== null && String(f).trim() !== "",
  ) || (bar?.eligiblePassingYears ?? []).length > 0;
