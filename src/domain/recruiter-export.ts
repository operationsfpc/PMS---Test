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

export const RECRUITER_CSV_COLUMNS = [...EXPORT_COLUMNS, "Resume link"] as const;
export type RecruiterCsvColumn = (typeof RECRUITER_CSV_COLUMNS)[number];
export type RecruiterCsvRow = Readonly<Record<RecruiterCsvColumn, string | number>>;

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
 * Builds rows for the recruiter CSV export with direct DB signed URLs
 * for each candidate's resume (instead of bundling separate files in a zip).
 */
export function buildRecruiterCsvRows(
  entries: readonly ShortlistEntry[],
  resumeSignedUrls: ReadonlyMap<string, string>,
): readonly RecruiterCsvRow[] {
  const included = entries.filter((e) => e.included);

  return included.map(({ snapshot }): RecruiterCsvRow => {
    const p = snapshot.profile;
    const resumeUrl = snapshot.resumeId ? (resumeSignedUrls.get(snapshot.resumeId) ?? "") : "";
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
      "Resume link": resumeUrl,
    };
  });
}

/**
 * How long a resume link in the recruiter's CSV keeps working.
 *
 * Stated once, here, because the same number has to appear in two places: the
 * view signs the links for this long, and the screen tells the coordinator how
 * long the file they are about to email stays openable (UAT 2026-10-18 — a CSV
 * whose links quietly stop working in a month is not a permanent pack).
 */
export const RESUME_LINK_DAYS = 30;
export const RESUME_LINK_TTL_SECONDS = RESUME_LINK_DAYS * 60 * 60 * 24;

/**
 * The two cells a link audit reads, in whichever CSV the row belongs to — the
 * recruiter's shortlist (#78) and the student directory's own export (#79) both
 * carry a "Resume link", and both have to say how many of them arrived empty.
 */
export interface ResumeLinkCells {
  readonly "Roll number": string | number;
  readonly "Resume link": string | number;
}

/**
 * #78: which candidates the CSV left without a link.
 *
 * A signed URL is missing for a reason the coordinator cannot see from the
 * file: the CV row was deleted, the storage read was refused, or the export
 * asked for more paths than one request can carry. All of them arrive as an
 * empty cell, and "Exported 42 candidates with resume links" over a CSV where
 * none of them linked is the defect this answers.
 */
export function resumeLinkShortfall(rows: readonly ResumeLinkCells[]): readonly string[] {
  return rows
    .filter((row) => String(row["Resume link"]).trim() === "")
    .map((row) => String(row["Roll number"]));
}

/** The same fact as one sentence, in the shape the screen prints. */
export function describeResumeLinks(rows: readonly ResumeLinkCells[]): string {
  const missing = resumeLinkShortfall(rows).length;
  const linked = rows.length - missing;
  if (missing === 0) {
    return `All ${rows.length} carry a resume link, openable for ${RESUME_LINK_DAYS} days.`;
  }
  if (linked === 0) {
    return `None of the ${rows.length} could be given a resume link — their CVs are not in this file.`;
  }
  return `${linked} of ${rows.length} carry a resume link, openable for ${RESUME_LINK_DAYS} days; ${missing} do not.`;
}

/** The folder every resume sits in, inside the pack. */
export const RESUME_FOLDER = "resumes";

/**
 * Characters Windows refuses in a filename, plus the separators that would
 * turn one candidate's file into a FOLDER inside the zip — and a sheet link
 * pointing at a file that is not where it says it is.
 */
const UNSAFE_IN_FILENAME = /[\\/:*?"<>|]/g;

/**
 * Control characters, stated by code point: Biome bans them inside a regex.
 * A pasted tab becomes the space it looks like; the rest simply go.
 */
const withoutControlCharacters = (raw: string) =>
  Array.from(raw)
    // A pasted tab becomes the space it looks like; every other control
    // character is dropped. `Number(undefined)` is NaN, which is not >= 32,
    // so no unreachable fallback has to be invented for an empty character.
    .map((character) => (character === "\t" ? " " : character))
    .filter((character) => Number(character.codePointAt(0)) >= 32)
    .join("");

function safeSegment(raw: string, replacement: string): string {
  return withoutControlCharacters(raw)
    .replaceAll(UNSAFE_IN_FILENAME, replacement)
    .replaceAll(/\s+/g, " ")
    .trim()
    .replaceAll(/^[.\s]+|[.\s]+$/g, "");
}

/**
 * What a candidate's resume is called inside the pack: named for the person
 * reading the folder, safe on the filesystem they will read it on.
 *
 * The roll number keeps its shape (a slash becomes a dash, so `21/CSE1042`
 * stays legible); the name simply loses what it may not contain.
 */
export function resumePackFilename(
  rollNumber: string,
  fullName: string,
  extension: string,
): string {
  const roll = safeSegment(rollNumber, "-");
  const name = safeSegment(fullName, "");
  const suffix = extension.trim() === "" ? "" : `.${extension.trim().replace(/^\.+/, "")}`;
  return `${name === "" ? roll : `${roll} - ${name}`}${suffix}`;
}

/**
 * The sheet's link to that file.
 *
 * UAT 2026-08-26: the workbook carried `Target="resumes/124 - Thanush
 * Krishna.pdf"` — a path, not a URI. Excel writes `%20` for a space and
 * answers "Cannot open the specified file" for anything that does not. The
 * resume was in the zip the whole time; the link was unfollowable.
 *
 * Relative on purpose: the pack must work wherever it is unzipped.
 */
export function resumeHyperlink(filename: string): string {
  return `${RESUME_FOLDER}/${encodeURIComponent(filename).replaceAll("'", "%27")}`;
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
