/**
 * Resuming a saved registration form.
 *
 * UAT 2026-08-05 asked for a draft so students can "continue the registration
 * later without losing their data". Restoring one is not a straight overwrite,
 * because three sources disagree and the order between them is a rule:
 *
 *   roster  >  draft  >  defaults
 *
 * IDENTITY ALWAYS COMES FROM THE ROSTER. A draft can be weeks old, and the
 * college may have corrected a roll number, a branch or a passing year since
 * it was written. Letting the draft win would silently restore the stale value
 * and send it for verification, where it fails against the marksheet — and the
 * student is the one who gets blamed for it. Those fields are disabled in the
 * form for exactly this reason; the draft must not be a way around that.
 */

/** The fields the roster owns. Never restored from a draft. */
const ROSTER_OWNED = [
  "fullName",
  "rollNumber",
  "email",
  "degree",
  "branch",
  "passingYear",
] as const;

export type RosterOwnedField = (typeof ROSTER_OWNED)[number];

/**
 * Fields a draft can never carry, whatever it claims.
 *
 * A File does not survive `JSON.stringify` — it becomes `{}` — so a draft
 * written while the student had picked their marksheets comes back with every
 * key present and every file gone. Restoring that would count the evidence as
 * provided, mark the section complete, and let a form reach the coordinator
 * carrying marks with nothing to check them against. The uploads are re-picked
 * instead, which is the only honest option.
 */
const NEVER_DRAFTED = ["marksheets", "resumes"] as const;

/**
 * What the student actually submitted, as far as this layer needs to know.
 *
 * Structural and entirely optional: it is satisfied by the feature layer's own
 * profile type without this file importing it, and a student who never got as
 * far as a figure simply does not have it.
 */
export interface SubmittedSrfRecord {
  readonly mobile?: string | null;
  readonly whatsapp?: string | null;
  readonly alternateContact?: string | null;
  readonly tenthInstitution?: string | null;
  readonly tenthPercentage?: number | null;
  readonly tenthBoard?: string | null;
  readonly tenthBoardState?: string | null;
  readonly tenthBoardOther?: string | null;
  readonly tenthGrade?: string | null;
  readonly twelfthInstitution?: string | null;
  readonly twelfthPercentage?: number | null;
  readonly twelfthBoard?: string | null;
  readonly twelfthBoardState?: string | null;
  readonly twelfthBoardOther?: string | null;
  readonly twelfthGrade?: string | null;
  readonly diplomaInstitution?: string | null;
  readonly diplomaUniversity?: string | null;
  readonly diplomaMarks?: number | null;
  readonly diplomaMarksScale?: string | null;
  readonly programmeLevel?: string | null;
  /** One scale for the whole degree; every semester figure was declared on it. */
  readonly marksScale?: string | null;
  readonly ugDegree?: string | null;
  readonly ugCollege?: string | null;
  readonly ugBranch?: string | null;
  readonly ugAggregate?: number | null;
  readonly ugAggregateScale?: string | null;
  readonly technicalSkills?: string | null;
  readonly areasOfInterest?: string | null;
  readonly areasOfExpertise?: string | null;
  readonly projects?: string | null;
  readonly achievements?: string | null;
  readonly linkedin?: string | null;
  readonly github?: string | null;
  readonly leetcode?: string | null;
  readonly hackerrank?: string | null;
  readonly otherProfiles?: readonly { readonly label: string; readonly value: string }[];
  readonly semesters?: readonly {
    readonly semesterNumber: number;
    readonly marks: number;
    readonly currentArrears: number;
    readonly historyOfArrears: number;
  }[];
}

/** An empty box, never `undefined`: React switches a controlled input for one. */
const str = (value: string | null | undefined): string => value ?? "";

/** A figure the student may legitimately not have stays absent, never zero. */
const orNull = (value: number | null | undefined): number | null => value ?? null;

/**
 * The form values a SENT-BACK student opens on (2026-08-18).
 *
 * `submit_srf` clears `srf_draft`, and the page merged roster identity and a
 * draft only - so a rejected form came back BLANK and the student retyped every
 * mark, school and phone number from memory. Correcting one line meant
 * re-declaring thirty, and a figure retyped from memory is a figure that can be
 * mistyped: the coordinator would then be verifying a new error rather than the
 * one they asked about.
 *
 * Deliberately NOT restored:
 *   uploads       - a File cannot be handed back to a browser, and a restored
 *                   key with no file behind it would count as evidence given;
 *   certificates   - same reason, each one is a name AND a document;
 *   consent        - consenting again is what resubmitting means.
 */
export function srfValuesFromSubmitted(record: SubmittedSrfRecord): Record<string, unknown> {
  /**
   * An empty list is NOT an answer, so the key is left out entirely.
   *
   * Every key present here overwrites the form's default, and the default is one
   * blank semester line. Handing back `[]` would leave the student with no line
   * to type into and an "add at least one semester" error on a form they had not
   * touched - which is how prefilling something absent turns into a dead end.
   */
  const semesters = (record.semesters ?? []).map((s) => ({
    semesterNumber: s.semesterNumber,
    marks: s.marks,
    currentArrears: s.currentArrears,
    historyOfArrears: s.historyOfArrears,
  }));

  return {
    ...(semesters.length === 0 ? {} : { semesters }),
    mobile: str(record.mobile),
    whatsapp: str(record.whatsapp),
    alternateContact: str(record.alternateContact),

    tenthInstitution: str(record.tenthInstitution),
    tenthPercentage: orNull(record.tenthPercentage),
    tenthBoard: str(record.tenthBoard),
    tenthBoardState: str(record.tenthBoardState),
    tenthBoardOther: str(record.tenthBoardOther),
    tenthGrade: str(record.tenthGrade),
    twelfthInstitution: str(record.twelfthInstitution),
    twelfthPercentage: orNull(record.twelfthPercentage),
    twelfthBoard: str(record.twelfthBoard),
    twelfthBoardState: str(record.twelfthBoardState),
    twelfthBoardOther: str(record.twelfthBoardOther),
    twelfthGrade: str(record.twelfthGrade),

    diplomaInstitution: str(record.diplomaInstitution),
    diplomaUniversity: str(record.diplomaUniversity),
    diplomaMarks: orNull(record.diplomaMarks),
    diplomaMarksScale: record.diplomaMarksScale ?? "cgpa",

    programmeLevel: record.programmeLevel ?? "ug",
    // Losing this would show a 74% back as a CGPA of 74 and the schema would
    // refuse the resubmission on a field the student never touched.
    collegeMarksScale: record.marksScale ?? "cgpa",

    ugDegree: str(record.ugDegree),
    ugCollege: str(record.ugCollege),
    ugBranch: str(record.ugBranch),
    ugAggregate: orNull(record.ugAggregate),
    ugAggregateScale: record.ugAggregateScale ?? "cgpa",

    technicalSkills: str(record.technicalSkills),
    areasOfInterest: str(record.areasOfInterest),
    areasOfExpertise: str(record.areasOfExpertise),
    projects: str(record.projects),
    achievements: str(record.achievements),

    linkedin: str(record.linkedin),
    github: str(record.github),
    leetcode: str(record.leetcode),
    hackerrank: str(record.hackerrank),
    otherProfiles: (record.otherProfiles ?? []).map((p) => ({ label: p.label, value: p.value })),

    marksheets: {},
    resumes: {},
    certificates: [],
    consent: false,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The form state to open with.
 *
 * Unknown keys in the draft are dropped: a draft written by an older version
 * of the form can carry fields the schema no longer has, and letting them
 * through would fail validation on a field the student cannot even see.
 */
export function mergeSrfDraft<TValues extends Record<string, unknown>>(
  defaults: TValues,
  roster: Partial<Record<RosterOwnedField, unknown>> | null,
  draft: unknown,
): TValues {
  const merged: Record<string, unknown> = { ...defaults };

  if (isRecord(draft)) {
    for (const key of Object.keys(defaults)) {
      if (NEVER_DRAFTED.includes(key as (typeof NEVER_DRAFTED)[number])) continue;
      if (key in draft) merged[key] = draft[key];
    }
  }

  // Last, so it wins over anything the draft restored.
  if (roster !== null) {
    for (const field of ROSTER_OWNED) {
      const value = (roster as Record<string, unknown>)[field];
      if (value !== undefined) merged[field] = value;
    }
  }

  return merged as TValues;
}
