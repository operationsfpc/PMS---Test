/**
 * PRD §5 — the Central Student Skill Repository.
 *
 * An institutional skill profile per student, maintained by the Central CPC:
 * aptitude, communication, programming, AI capability and whatever else the
 * institution assesses. These scores later feed R11's shortlisting
 * (`rankApplicants`), which is why the validation lives here and not on a
 * screen — a wrong number admitted here becomes a wrong shortlist there.
 *
 * ✅ A35 ANSWERED (Karthik, 2026-08-19): "1-5 SCALE". Whole numbers 1–5 —
 * ⚠️ half-points refused, an assumption; one line here if he wants 3.5.
 * ✅ A36 ANSWERED same day: "Students do not see their scores" — which is
 * what 0037's read policy already enforces (students read NOTHING).
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

export const SKILL_SCORE_MIN = 1;
export const SKILL_SCORE_MAX = 5;
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
 * One score, as typed. Whole numbers on the 1–5 scale: silently rounding a
 * coordinator's 3.5 would store a number they never typed, and a 0–100 figure
 * pasted from last term's sheet must be refused loudly, not scaled quietly.
 */
export function parseSkillScore(raw: string): ParsedScore {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "Enter a score." };

  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a number.` };
  if (value < SKILL_SCORE_MIN || value > SKILL_SCORE_MAX) {
    return { ok: false, reason: `A score is between ${SKILL_SCORE_MIN} and ${SKILL_SCORE_MAX}.` };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, reason: "Whole numbers only on the 1–5 scale." };
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

/**
 * The PIF's mandatory-skills picker (spec 2026-08-21 part A, approved
 * 2026-08-24 — "Only these skills should be selectable by the account
 * executive when raising the PIF. Anything outside this list he has to call
 * it out as other skills.").
 *
 * Storage stays `drives.mandatory_skills` comma-joined text — everything
 * downstream (shortlist chips, rankApplicants, the record page, the publish
 * line) already reads that shape — so these two functions are the ONLY
 * translation between the picker and the column, in both directions.
 */
export interface MandatorySkillsSplit {
  /** Names matching the assessed-skills catalogue, in canonical casing. */
  readonly catalogue: readonly string[];
  /** Everything else, verbatim (trimmed) — the AE's "other skills". */
  readonly other: readonly string[];
}

/** Stored text → picker state. Nothing is dropped; unknowns become "other". */
export function splitMandatorySkills(
  stored: string,
  catalogueNames: readonly string[],
): MandatorySkillsSplit {
  const canonical = new Map(
    catalogueNames.map((n) => [skillAreaKey(n), normaliseSkillAreaName(n)]),
  );
  const catalogue: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();

  for (const part of stored.split(",")) {
    const name = normaliseSkillAreaName(part);
    if (name === "") continue;
    const key = skillAreaKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = canonical.get(key);
    if (known === undefined) other.push(name);
    else catalogue.push(known);
  }

  return { catalogue, other };
}

/** Picker state → stored text. An "other" naming a catalogue skill folds in. */
export function joinMandatorySkills(
  picked: readonly string[],
  other: readonly string[],
  catalogueNames: readonly string[],
): string {
  const split = splitMandatorySkills([...picked, ...other].join(","), catalogueNames);
  return [...split.catalogue, ...split.other].join(", ");
}
