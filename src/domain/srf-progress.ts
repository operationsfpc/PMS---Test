/**
 * Real-time progress through the seven-step registration form. PRD §4.
 *
 * UAT 2026-08-05: "the progress tracker does not accurately reflect the
 * student's real-time progress." It was hardcoded — the first pill was always
 * lit and the other six never were, whatever had been filled in.
 *
 * A progress bar that lies is worse than none. A student who believes they
 * have finished stops, and their form sits unsubmitted until somebody chases
 * them — which is the exact failure the tracker exists to prevent. So
 * "complete" here means what the schema will actually accept, and the rule
 * lives beside the schema's own predicates rather than in the component.
 */

import { type SchoolBoard, validateBoardSelection } from "./boards";
import { missingMarksheets } from "./marksheets";
import { missingResumesFor } from "./srf-rules";
import type { RoleCategory } from "./types";

/** Only the fields that decide completeness, so the form can change freely. */
export interface SrfProgressInput {
  readonly mobile: string;
  readonly alternateContact: string;
  /** The school each school figure came from; asked before the marks. */
  readonly tenthInstitution: string;
  readonly tenthPercentage?: number | null;
  readonly tenthGrade?: string;
  /**
   * And the board that issued it (2026-08-18). Mandatory for every student, so
   * the tracker must not read 100% while it is empty.
   */
  readonly tenthBoard: SchoolBoard | string | null;
  readonly tenthBoardState: string | null;
  readonly tenthBoardOther: string | null;
  readonly twelfthInstitution: string;
  readonly twelfthPercentage?: number | null;
  readonly twelfthGrade?: string;
  readonly twelfthBoard: SchoolBoard | string | null;
  readonly twelfthBoardState: string | null;
  readonly twelfthBoardOther: string | null;
  /** Optional to declare; once declared it must be evidenced like any mark. */
  readonly hasDiplomaMarks: boolean;
  readonly degree?: string;
  readonly programmeLevel: "ug" | "pg";
  readonly ugAggregateCgpa: number | null;
  readonly semesters: readonly {
    readonly semesterNumber: number;
    readonly cgpa: number;
  }[];
  /**
   * Keys of the marksheets actually provided (`src/domain/marksheets.ts`).
   *
   * Was a bare count, which let ANY single file complete the section. The
   * uploads were discarded anyway, so a student could reach 100% having
   * evidenced nothing at all.
   */
  readonly marksheets: readonly string[];
  readonly roleCategories: readonly RoleCategory[];
  readonly resumeCategories: readonly RoleCategory[];
  readonly consent: boolean;
}

export interface SrfSectionState {
  readonly id: string;
  readonly title: string;
  readonly step: number;
  /** Nothing in it is required, so it never holds the student up. */
  readonly optional: boolean;
  readonly complete: boolean;
}

/** A number the student typed, as opposed to an empty box. */
const given = (value: number) => Number.isFinite(value);

const filled = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim() !== "";

export function srfSectionProgress(input: SrfProgressInput): readonly SrfSectionState[] {
  // Both are mandatory: a student who cannot be reached on drive day loses the
  // opportunity, and the college loses the recruiter.
  const personal = filled(input.mobile) && filled(input.alternateContact);

  const semestersEntered =
    input.semesters.length > 0 && input.semesters.every((s) => given(s.cgpa));

  /**
   * Academics and the documents that prove them are ONE section since
   * 2026-08-06: "do not keep marksheet upload as a separate section 3. upload
   * near relevant fields in section 2 itself."
   *
   * A student used to enter a mark in one section and find its document in
   * another, matching them up from memory - which is also how a marksheet
   * ended up filed against the wrong semester. So this section is not done
   * until every figure on it carries its evidence.
   */
  /**
   * The board, judged by the same rule the form and the database use - a State
   * Board with no state names 36 boards, and "Other" with nothing typed names
   * none.
   */
  const boardAnswered = (
    board: string | null,
    state: string | null,
    other: string | null,
  ): boolean =>
    validateBoardSelection({
      board: board === null || board === "" ? null : (board as SchoolBoard),
      state,
      other,
    }).length === 0;

  const tenthIsGrade = input.tenthBoard === "cambridge" || input.tenthBoard === "other";
  const tenthMarkGiven = tenthIsGrade
    ? filled(input.tenthGrade ?? "")
    : input.tenthPercentage !== null &&
      input.tenthPercentage !== undefined &&
      given(input.tenthPercentage);

  const twelfthIsGrade = input.twelfthBoard === "cambridge" || input.twelfthBoard === "other";
  const twelfthMarkGiven = twelfthIsGrade
    ? filled(input.twelfthGrade ?? "")
    : input.twelfthPercentage !== null &&
      input.twelfthPercentage !== undefined &&
      given(input.twelfthPercentage);

  const academic =
    (input.degree === undefined || filled(input.degree)) &&
    filled(input.tenthInstitution) &&
    tenthMarkGiven &&
    boardAnswered(input.tenthBoard, input.tenthBoardState, input.tenthBoardOther) &&
    filled(input.twelfthInstitution) &&
    twelfthMarkGiven &&
    boardAnswered(input.twelfthBoard, input.twelfthBoardState, input.twelfthBoardOther) &&
    semestersEntered &&
    (input.programmeLevel === "ug" || input.ugAggregateCgpa !== null) &&
    missingMarksheets(input, input.marksheets).length === 0;

  // R7 sends ONE resume per role category to the recruiter, so a preference
  // without its resume is not a finished choice.
  const preferences =
    input.roleCategories.length > 0 &&
    missingResumesFor(input.roleCategories, input.resumeCategories).length === 0;

  return [
    { id: "personal", title: "Personal details", step: 1, optional: false, complete: personal },
    { id: "academic", title: "Academic record", step: 2, optional: false, complete: academic },
    {
      id: "preferences",
      title: "Placement preferences",
      step: 3,
      optional: false,
      complete: preferences,
    },
    // Nothing in these two is required by the schema. Marking them incomplete
    // would strand a student with no GitHub at 4 of 6 for ever.
    { id: "profiles", title: "Professional profiles", step: 4, optional: true, complete: true },
    {
      id: "additional",
      title: "Skills and achievements",
      step: 5,
      optional: true,
      complete: true,
    },
    {
      id: "consent",
      title: "Consent and submission",
      step: 6,
      optional: false,
      complete: input.consent,
    },
  ];
}

/**
 * How far through the student is, as a percentage.
 *
 * Measured over the REQUIRED sections only. Counting the optional ones would
 * start every student at 29% for having done nothing, which flatters the form
 * and misleads the person filling it in.
 */
export function srfCompletion(input: SrfProgressInput): number {
  const required = srfSectionProgress(input).filter((s) => !s.optional);
  const done = required.filter((s) => s.complete).length;
  return Math.round((done / required.length) * 100);
}
