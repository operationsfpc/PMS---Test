/**
 * Which board issued a school mark. Asked for 2026-08-18.
 *
 * A dropdown, not a text box (answer 1a). Free text yields `cbse`, `C.B.S.E.`,
 * `Central Board` and `CBSE ` - four boards to Postgres, one board to a human,
 * and no report can ever group them. Two boards need a second answer to
 * identify them at all, and those two rules are the whole of this file:
 *
 *   State Board -> WHICH state (answer 3). "State Board" alone is 36 boards.
 *   Other       -> what it is called, in the student's own words.
 *
 * The pair is validated here rather than in the form, because `0048` enforces
 * exactly the same shape with check constraints and the two must not be able
 * to disagree about what a coherent answer looks like.
 */

export const SCHOOL_BOARDS = [
  "state_board",
  "cbse",
  "cisce",
  "nios",
  "ib",
  "cambridge",
  "other",
] as const;

export type SchoolBoard = (typeof SCHOOL_BOARDS)[number];

/** Which school figure is being described. Decides two of the labels. */
export type SchoolLevel = "tenth" | "twelfth";

export function isSchoolBoard(value: string): value is SchoolBoard {
  return (SCHOOL_BOARDS as readonly string[]).includes(value);
}

/**
 * The 28 states and 8 union territories, alphabetical.
 *
 * Alphabetical because a native `<select>` is searched by typing, and a list
 * in any other order makes the student hunt.
 */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

/**
 * What the student is shown in the dropdown.
 *
 * CISCE runs ICSE at class 10 and ISC at class 12; Cambridge is IGCSE/O-Level
 * then A-Level. ONE stored value with two labels, rather than two enum values:
 * separate values would let a student record "ISC" against their tenth, and
 * nothing downstream could tell that apart from a real answer.
 */
export function boardLabel(board: SchoolBoard, level: SchoolLevel): string {
  switch (board) {
    case "state_board":
      return "State Board";
    case "cbse":
      return "CBSE";
    case "cisce":
      return level === "tenth" ? "ICSE (CISCE)" : "ISC (CISCE)";
    case "nios":
      return "NIOS";
    case "ib":
      return "International Baccalaureate (IB)";
    case "cambridge":
      return level === "tenth" ? "Cambridge (IGCSE / O-Level)" : "Cambridge (A-Level)";
    case "other":
      return "Other";
  }
}

/**
 * A board as it is answered: the choice, plus whichever second answer that
 * choice demands. Both extras are null for the five boards that need neither.
 */
export interface BoardSelection {
  readonly board: SchoolBoard | null;
  readonly state: string | null;
  readonly other: string | null;
}

/**
 * The same answer as a caller may actually hold it.
 *
 * `describeBoard` is rendered for every row of the coordinator's queue, and it
 * is read from data that predates these columns. An absent field must read as
 * "Not recorded", never throw: when it did, the whole verification queue
 * rendered blank - one missing field took out the screen.
 */
export interface PartialBoardSelection {
  readonly board?: SchoolBoard | null | undefined;
  readonly state?: string | null | undefined;
  readonly other?: string | null | undefined;
}

/** What was typed, trimmed. An absent answer and a blank one are one thing. */
const text = (value: string | null | undefined): string => (value ?? "").trim();

const isIndianState = (value: string): boolean =>
  (INDIAN_STATES as readonly string[]).includes(value);

/**
 * Every problem with the answer, at once.
 *
 * Both directions are checked. A state against CBSE is not harmless noise: it
 * would be stored, shown to a coordinator beside the marksheet, and read as a
 * fact about the student. The database refuses the same pairs.
 */
export function validateBoardSelection(selection: BoardSelection): readonly string[] {
  const problems: string[] = [];

  if (selection.board === null) {
    problems.push("Select the board.");
  }

  /**
   * Trimmed once, up front. Reading `selection.state ?? ""` at each use adds a
   * fallback that can never be taken - and an unreachable branch is a branch no
   * test can cover, which is how a coverage gate ends up being argued with
   * rather than met.
   */
  const state = text(selection.state);
  const other = text(selection.other);

  if (selection.board === "state_board") {
    if (state === "" || !isIndianState(state)) {
      problems.push("Select which state's board it was.");
    }
  } else if (state !== "") {
    problems.push("Only select a state when you have selected State Board.");
  }

  if (selection.board === "other") {
    if (other === "") problems.push("Name the board.");
  } else if (other !== "") {
    problems.push("Only name the board when you have selected Other.");
  }

  return problems;
}

/**
 * The board in one line, for the coordinator's queue and the read-only record.
 *
 * Never blank. Five students registered before boards existed, and an empty
 * cell reads as a claim about the student rather than a gap in the record.
 */
export function describeBoard(
  selection: PartialBoardSelection | null | undefined,
  level: SchoolLevel,
): string {
  if (selection === null || selection === undefined) return "Not recorded";
  if (selection.board === null || selection.board === undefined) return "Not recorded";

  if (selection.board === "state_board") {
    const state = text(selection.state);
    return state === "" ? "State Board" : `State Board — ${state}`;
  }

  if (selection.board === "other") {
    const other = text(selection.other);
    return other === "" ? "Other" : other;
  }

  return boardLabel(selection.board, level);
}
