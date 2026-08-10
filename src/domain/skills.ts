/**
 * PRD §5 — the Central Student Skill Repository.
 *
 * An institutional skill profile per student, maintained by the Central CPC:
 * aptitude, communication, programming, AI capability and whatever else the
 * institution assesses. These scores later feed R11's shortlisting
 * (`rankApplicants`), which is why the validation lives here and not on a
 * screen — a wrong number admitted here becomes a wrong shortlist there.
 *
 * ⚠️ ASSUMPTION — UNCONFIRMED (A35, refines A12): a score is 0–100 with at
 * most two decimals. The client named the areas but not the scale.
 */

/** The areas asked for on 2026-08-06. Seeds — the Central CPC can add more. */
export const DEFAULT_SKILL_AREAS = [
  "Aptitude",
  "Communication skills",
  "Fundamentals of Programming",
  "Data Structures and Algorithms",
  "GitHub strength",
  "Programming skills",
  "AI skills",
  "AI-assisted Full Stack Development",
] as const;

export const SKILL_SCORE_MIN = 0;
export const SKILL_SCORE_MAX = 100;
export const SKILL_AREA_NAME_MAX = 60;

/** What a human meant: trimmed, single-spaced. */
export function normaliseSkillAreaName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The uniqueness key. "AI skills" and "ai  Skills" are the same area to the
 * person reading a shortlist, so they must be the same area here. Mirrored by
 * the unique index in migration 0037 — the two must not drift.
 */
export function skillAreaKey(name: string): string {
  return normaliseSkillAreaName(name).toLowerCase();
}

/** Why a proposed area name is unusable, or null when it is fine. */
export function validateSkillAreaName(name: string, existing: readonly string[]): string | null {
  const normalised = normaliseSkillAreaName(name);
  if (normalised === "") return "Give the skill area a name.";
  if (normalised.length > SKILL_AREA_NAME_MAX) {
    return `Keep the name to ${SKILL_AREA_NAME_MAX} characters or fewer.`;
  }
  const clash = existing.find((e) => skillAreaKey(e) === skillAreaKey(normalised));
  if (clash !== undefined) {
    return `"${normaliseSkillAreaName(clash)}" already exists — edit the scores under it instead.`;
  }
  return null;
}

export type ParsedScore =
  | { readonly ok: true; readonly score: number }
  | { readonly ok: false; readonly reason: string };

/**
 * One score, as typed. Two decimals at most: the storage column is
 * numeric(5,2), and silently rounding a coordinator's entry would store a
 * number they never typed.
 */
export function parseSkillScore(raw: string): ParsedScore {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "Enter a score." };

  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a number.` };
  if (value < SKILL_SCORE_MIN || value > SKILL_SCORE_MAX) {
    return { ok: false, reason: `A score is between ${SKILL_SCORE_MIN} and ${SKILL_SCORE_MAX}.` };
  }
  if (Math.round(value * 100) !== value * 100) {
    return { ok: false, reason: "Use at most two decimal places." };
  }
  return { ok: true, score: value };
}

export interface SkillSheetScore {
  /** Canonical area name — the known spelling, never the header's. */
  readonly area: string;
  readonly score: number;
}

export interface SkillSheetRow {
  /** 1-based spreadsheet row, counting the header — for reporting. */
  readonly row: number;
  readonly rollNumber: string;
  readonly scores: readonly SkillSheetScore[];
}

export interface SkillSheetRejection {
  /** 1-based spreadsheet row, counting the header — what the coordinator sees. */
  readonly row: number;
  readonly reason: string;
}

export interface SkillSheetResult {
  readonly accepted: readonly SkillSheetRow[];
  readonly rejected: readonly SkillSheetRejection[];
  /** Set when the file as a whole cannot be used; `accepted` is then empty. */
  readonly fatal: string | null;
}

/**
 * The bulk upload (PRD §5: "Excel-template bulk import with validation and
 * error reporting … row-level failure reporting").
 *
 * Template: `roll_number` first, then one column per skill area. A blank cell
 * is SKIPPED, never read as zero — which is also what makes this the bulk
 * EDIT: upload only the column being changed and every other score survives.
 *
 * An unknown column is fatal rather than skipped: a misspelt "Aptitide"
 * column silently dropped would discard an entire assessment and report
 * success.
 */
export function parseSkillSheet(
  rows: readonly (readonly string[])[],
  knownAreas: readonly string[],
): SkillSheetResult {
  const empty = { accepted: [], rejected: [] };

  const header = rows[0];
  if (header === undefined) return { ...empty, fatal: "The file is empty." };

  const first = header[0]?.trim().toLowerCase() ?? "";
  if (first !== "roll_number") {
    return { ...empty, fatal: 'The first column must be "roll_number".' };
  }
  if (header.length < 2) {
    return { ...empty, fatal: "Add at least one skill column after roll_number." };
  }

  const canonical = new Map(knownAreas.map((a) => [skillAreaKey(a), normaliseSkillAreaName(a)]));
  const columns: string[] = [];
  const seenColumns = new Set<string>();
  for (let i = 1; i < header.length; i++) {
    const cellText = header[i] ?? "";
    const key = skillAreaKey(cellText);
    const known = canonical.get(key);
    if (known === undefined) {
      return {
        ...empty,
        fatal: `Column "${cellText.trim()}" is not a skill area. Add it as a skill area first, then import.`,
      };
    }
    if (seenColumns.has(key)) {
      return { ...empty, fatal: `Column "${cellText.trim()}" appears more than once.` };
    }
    seenColumns.add(key);
    columns.push(known);
  }

  const accepted: SkillSheetRow[] = [];
  const rejected: SkillSheetRejection[] = [];
  const seenRolls = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    const rowNumber = i + 1;

    // Spreadsheets are full of trailing blank rows; they are not errors.
    if (raw.every((v) => v.trim() === "")) continue;

    const reject = (reason: string) => rejected.push({ row: rowNumber, reason });

    const rollNumber = (raw[0] ?? "").trim();
    if (rollNumber === "") {
      reject("Roll number is missing.");
      continue;
    }
    if (seenRolls.has(rollNumber)) {
      reject(`Duplicate roll number "${rollNumber}" — an earlier row already claims it.`);
      continue;
    }

    const scores: SkillSheetScore[] = [];
    let bad: string | null = null;
    for (const [c, area] of columns.entries()) {
      const cellText = (raw[c + 1] ?? "").trim();
      if (cellText === "") continue; // Skipped, never zero.
      const parsed = parseSkillScore(cellText);
      if (!parsed.ok) {
        bad = `${area}: ${parsed.reason}`;
        break;
      }
      scores.push({ area, score: parsed.score });
    }
    if (bad !== null) {
      reject(bad);
      continue;
    }
    if (scores.length === 0) {
      reject("Every score cell on this row is blank.");
      continue;
    }

    seenRolls.add(rollNumber);
    accepted.push({ row: rowNumber, rollNumber, scores });
  }

  return { accepted, rejected, fatal: null };
}
