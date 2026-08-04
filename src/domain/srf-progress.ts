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

import { missingResumesFor } from "./srf-rules";
import type { RoleCategory } from "./types";

/** Only the fields that decide completeness, so the form can change freely. */
export interface SrfProgressInput {
  readonly mobile: string;
  readonly alternateContact: string;
  readonly tenthPercentage: number;
  readonly twelfthPercentage: number;
  readonly programmeLevel: "ug" | "pg";
  readonly ugAggregateCgpa: number | null;
  readonly semesters: readonly { readonly cgpa: number }[];
  readonly marksheetCount: number;
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

const filled = (value: string) => value.trim() !== "";

export function srfSectionProgress(input: SrfProgressInput): readonly SrfSectionState[] {
  // Both are mandatory: a student who cannot be reached on drive day loses the
  // opportunity, and the college loses the recruiter.
  const personal = filled(input.mobile) && filled(input.alternateContact);

  const semestersEntered =
    input.semesters.length > 0 && input.semesters.every((s) => given(s.cgpa));

  const academic =
    given(input.tenthPercentage) &&
    given(input.twelfthPercentage) &&
    semestersEntered &&
    (input.programmeLevel === "ug" || input.ugAggregateCgpa !== null);

  // R7 sends ONE resume per role category to the recruiter, so a preference
  // without its resume is not a finished choice.
  const preferences =
    input.roleCategories.length > 0 &&
    missingResumesFor(input.roleCategories, input.resumeCategories).length === 0;

  return [
    { id: "personal", title: "Personal details", step: 1, optional: false, complete: personal },
    { id: "academic", title: "Academic record", step: 2, optional: false, complete: academic },
    {
      id: "marksheets",
      title: "Marksheet uploads",
      step: 3,
      optional: false,
      complete: input.marksheetCount > 0,
    },
    {
      id: "preferences",
      title: "Placement preferences",
      step: 4,
      optional: false,
      complete: preferences,
    },
    // Nothing in these two is required by the schema. Marking them incomplete
    // would strand a student with no GitHub at 5 of 7 for ever.
    { id: "profiles", title: "Professional profiles", step: 5, optional: true, complete: true },
    {
      id: "additional",
      title: "Skills and achievements",
      step: 6,
      optional: true,
      complete: true,
    },
    {
      id: "consent",
      title: "Consent and submission",
      step: 7,
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
