/**
 * What a college runs, for a given year of passing. F6 (UAT 2026-08-06).
 *
 * "A separate page for degree and branches is not required for the admin. This
 * is always mapped to colleges for a particular year of Passing. Degree+Branch
 * is one field. This can be added or edited later under the colleges created.
 * Students can just select this from a drop down while filling the form."
 *
 * Degrees and branches used to be a global catalogue maintained on their own
 * screen, with no notion of which college ran what, or when. That is two
 * problems at once:
 *
 *   - an Admin adding "AI and DS" added it EVERYWHERE, so a student at a
 *     college that has never run it could select it;
 *   - a branch that stopped running in 2026 was still offered to the 2028
 *     cohort, because nothing recorded the year.
 *
 * A programme is therefore the whole tuple: college + degree + branch + year.
 * The student picks one field because there is only ever one thing to pick.
 */

/** Shown wherever a programme is named. Long dash: it reads as one label. */
const SEPARATOR = " — ";

/**
 * Not the separator. A degree may legitimately contain a slash or a dash
 * ("B.Tech / B.E"), so splitting on the visible label would produce the wrong
 * halves — the key uses a character no institution puts in a name.
 */
const KEY_SEPARATOR = "\u001f";

export interface CampusProgramme {
  readonly campusId: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
}

/** How a programme reads to a human: one field, because it is one choice. */
export function programmeLabel(degree: string, branch: string): string {
  const left = degree.trim();
  const right = branch.trim();

  // A degree that genuinely has no branches (MBA) must not read "MBA — ".
  return right === "" ? left : `${left}${SEPARATOR}${right}`;
}

/** The dropdown's value. Both halves survive it; students still store both. */
export function programmeKey(degree: string, branch: string): string {
  return `${degree.trim()}${KEY_SEPARATOR}${branch.trim()}`;
}

export function splitProgrammeKey(key: string): { degree: string; branch: string } {
  const [degree = "", branch = ""] = key.split(KEY_SEPARATOR);
  return { degree, branch };
}

/**
 * What this student may choose from.
 *
 * Scoped by college AND passing year, which is the whole point: those two
 * facts come from the roster, so the list a student sees is the list their
 * college actually runs for their cohort.
 */
export function programmesFor(
  all: readonly CampusProgramme[],
  student: { readonly campusId: string; readonly passingYear: number },
): readonly CampusProgramme[] {
  return all
    .filter((p) => p.campusId === student.campusId && p.passingYear === student.passingYear)
    .sort((a, b) => a.degree.localeCompare(b.degree) || a.branch.localeCompare(b.branch));
}

/**
 * ⚠️ ASSUMPTION — UNCONFIRMED (A34). The window a passing year may fall in.
 * Wide enough for a first-year student and for a cohort that graduated five
 * years ago; narrow enough that a typo ("2072") is refused.
 */
const EARLIEST_PASSING_YEAR = 2015;
const LATEST_PASSING_YEAR = 2100;

/** Every problem at once — an Admin fixing one field per submit gives up. */
export function validateProgramme(programme: CampusProgramme): readonly string[] {
  const problems: string[] = [];

  if (programme.campusId.trim() === "") {
    problems.push("Choose the college that runs this programme.");
  }
  if (programme.degree.trim() === "") {
    problems.push("Enter the degree.");
  }
  if (
    !Number.isInteger(programme.passingYear) ||
    programme.passingYear < EARLIEST_PASSING_YEAR ||
    programme.passingYear > LATEST_PASSING_YEAR
  ) {
    problems.push("Enter a realistic year of passing.");
  }

  // A branch is deliberately NOT required: an MBA has none, and demanding one
  // would force an Admin to invent a name that then appears in a dropdown.
  return problems;
}
