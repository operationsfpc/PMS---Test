import type { ApplicationSnapshot } from "./application-snapshot";

/**
 * The recruiter export (PRD §14).
 *
 * Built from application SNAPSHOTS, never live profiles (R7). A student who
 * edits their profile after applying - or a coordinator correcting a verified
 * figure mid-drive - must not change what a recruiter has already been given.
 * An export regenerated next week must match the file sent last week.
 *
 * Exporting is a data-sharing event: it is audit-logged by the caller. This
 * function decides only what leaves the building.
 */
export const EXPORT_COLUMNS = [
  "Roll number",
  "Name",
  "Email",
  "Degree",
  "Branch",
  "Passing year",
  "Overall CGPA",
  "10th %",
  "12th %",
  "Standing arrears",
  "Arrear history",
  "Technical skills",
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportRow = Readonly<Record<ExportColumn, string | number>>;

export interface ShortlistEntry {
  readonly applicationId: string;
  readonly included: boolean;
  readonly snapshot: ApplicationSnapshot;
}

export interface RecruiterExport {
  readonly rows: readonly ExportRow[];
  /** Resumes to bundle alongside the sheet. */
  readonly resumeIds: readonly string[];
  /** Shortlisted candidates with no resume for this role category. */
  readonly missingResumes: readonly string[];
}

export function buildRecruiterExport(entries: readonly ShortlistEntry[]): RecruiterExport {
  const included = entries.filter((e) => e.included);

  const rows = included.map(({ snapshot }): ExportRow => {
    const p = snapshot.profile;
    return {
      "Roll number": p.rollNumber,
      Name: p.fullName,
      Email: p.email,
      Degree: p.degree,
      Branch: p.branch,
      "Passing year": p.passingYear,
      "Overall CGPA": p.overallCgpa,
      "10th %": p.tenthPercentage,
      "12th %": p.twelfthPercentage,
      "Standing arrears": p.currentArrears,
      "Arrear history": p.historyOfArrears,
      "Technical skills": p.technicalSkills,
    };
  });

  return {
    rows,
    resumeIds: included.flatMap((e) => (e.snapshot.resumeId === null ? [] : [e.snapshot.resumeId])),
    // Surfaced rather than silently dropped: a shortlisted candidate with no
    // CV is a problem the coordinator must see before the pack is sent.
    missingResumes: included.flatMap((e) =>
      e.snapshot.resumeId === null ? [e.snapshot.profile.rollNumber] : [],
    ),
  };
}

/**
 * Answer 5b (2026-08-24): the pack is whole or it does not leave. A recruiter
 * reading a folder of resumes against a sheet of names does not re-count
 * them — a missing CV would simply read as a candidate who was never sent.
 */
export function recruiterPackProblem(pack: RecruiterExport): string | null {
  if (pack.missingResumes.length === 0) return null;
  return `The shortlist cannot be exported: no resume on file for roll number${
    pack.missingResumes.length === 1 ? "" : "s"
  } ${pack.missingResumes.join(", ")}. Ask the student${
    pack.missingResumes.length === 1 ? "" : "s"
  } to upload one, or remove them from the shortlist.`;
}
