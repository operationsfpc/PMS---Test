/**
 * Roster import (PRD §3).
 *
 * Format: `public/templates/student-roster-template.xlsx`, confirmed canonical
 * on 2026-08-02.
 *
 * A roster entry is the ONLY way a student can ever sign in - the allowlist in
 * migration 0009 refuses any address that is not on it. A silently dropped row
 * is therefore a student locked out of placements for the year, so every
 * rejection is reported with its spreadsheet row number and a reason a
 * coordinator can act on.
 */
import { type EmailHolder, emailClash } from "./email-identity";

export const ROSTER_COLUMNS = [
  "roll_number",
  "name",
  "email",
  "degree",
  "branch",
  "passing_year",
] as const;

export interface RosterStudent {
  readonly rollNumber: string;
  readonly fullName: string;
  readonly email: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
}

export interface RosterRejection {
  /** 1-based spreadsheet row, counting the header - what the coordinator sees. */
  readonly row: number;
  readonly reason: string;
}

export interface RosterParseResult {
  readonly accepted: readonly RosterStudent[];
  readonly rejected: readonly RosterRejection[];
  /** Set when the file cannot be read at all; `accepted` is then empty. */
  readonly fatal: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cell = (row: readonly string[], index: number) => (row[index] ?? "").trim();

/**
 * @param taken Addresses already claimed, keyed by NORMALISED address (0040).
 *   One email identifies one person, so a roster row naming a colleague's
 *   staff address is refused here rather than failing the whole batch at the
 *   database. Defaults to empty: the parser is still usable on shape alone.
 */
export function parseRoster(
  rows: readonly (readonly string[])[],
  taken: ReadonlyMap<string, EmailHolder> = new Map(),
): RosterParseResult {
  const empty = { accepted: [], rejected: [] };

  const header = rows[0];
  if (header === undefined) {
    return { ...empty, fatal: "The file is empty." };
  }

  const actual = header.map((h) => h.trim().toLowerCase());
  const expected = [...ROSTER_COLUMNS];
  if (actual.length !== expected.length || expected.some((c, i) => actual[i] !== c)) {
    return {
      ...empty,
      fatal: `The columns do not match the template. Expected: ${expected.join(", ")}.`,
    };
  }

  const accepted: RosterStudent[] = [];
  const rejected: RosterRejection[] = [];
  const seenEmails = new Set<string>();
  const seenRolls = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    const rowNumber = i + 1;

    // Spreadsheets are full of trailing blank rows; they are not errors.
    // `every` skips holes in a sparse row, and the element type is string, so
    // no undefined guard is reachable here. Short rows are handled by `cell`.
    if (raw.every((v) => v.trim() === "")) continue;

    const rollNumber = cell(raw, 0);
    const fullName = cell(raw, 1);
    const email = cell(raw, 2).toLowerCase();
    const degree = cell(raw, 3);
    const branch = cell(raw, 4);
    const yearText = cell(raw, 5);

    const reject = (reason: string) => rejected.push({ row: rowNumber, reason });

    if (rollNumber === "") {
      reject("Roll number is missing.");
      continue;
    }
    if (fullName === "") {
      reject("Name is missing.");
      continue;
    }
    if (email === "") {
      reject("Email is missing. Without it the student cannot sign in.");
      continue;
    }
    if (!EMAIL.test(email)) {
      reject(`"${email}" is not a valid email address.`);
      continue;
    }
    if (degree === "") {
      reject("Degree is missing.");
      continue;
    }

    const passingYear = Number(yearText);
    if (!Number.isInteger(passingYear) || passingYear < 2000 || passingYear > 2100) {
      reject(`Passing year "${yearText}" is not a four-digit year.`);
      continue;
    }

    if (seenEmails.has(email)) {
      reject(`Duplicate email "${email}" — an earlier row already claims it.`);
      continue;
    }
    if (seenRolls.has(rollNumber)) {
      reject(`Duplicate roll number "${rollNumber}" — an earlier row already claims it.`);
      continue;
    }

    // 0040: one address is one person. Checked after the within-file rules so
    // the more specific "an earlier row already claims it" still wins.
    const clash = emailClash(email, taken, "student");
    if (clash !== null) {
      reject(clash);
      continue;
    }

    seenEmails.add(email);
    seenRolls.add(rollNumber);
    accepted.push({ rollNumber, fullName, email, degree, branch, passingYear });
  }

  return { accepted, rejected, fatal: null };
}
