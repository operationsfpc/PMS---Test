import type { Tone } from "@components/ui";
import { driveTypeLabel } from "@domain/drive-type";
import { DRIVE_TYPES } from "@domain/types";

/**
 * Label maps and small helpers shared by both PIF forms and the AE screens
 * that print PIF-derived facts. Everything here is data, not behaviour.
 */

/**
 * The AE's sections, in the order the ONE PIF asks them (UAT 2026-08-19 A1/A3):
 * who the company is and when it is coming, then each role. Drive type and
 * compensation are per role now — a placement role and an internship role can
 * belong to the same visit — so the type is the first question INSIDE each role
 * block rather than a section of its own.
 */
export const PIF_SECTIONS = [
  { id: "company", short: "Company", title: "Company details" },
  { id: "event", short: "Drive day", title: "Drive day, mode and joining" },
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

/** What the event picker says about where a drive is in its life. */
export const EVENT_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Pending approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  live: { label: "Live", tone: "success" },
  applications_closed: { label: "Applications closed", tone: "warning" },
  in_rounds: { label: "In rounds", tone: "warning" },
  completed: { label: "Completed", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
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
