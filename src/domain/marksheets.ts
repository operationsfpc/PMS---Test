/**
 * Which documents a declared academic record must be evidenced by. PRD §4.2.
 *
 * The SRF asked a student for these uploads, let them pick their files, and
 * discarded every one. Nothing reached storage and nothing was recorded, so
 * the coordinator's verification queue — whose entire purpose is checking a
 * declared CGPA against the marksheet that proves it — had nothing to check
 * against. Approving there was rubber-stamping the student's own typing.
 *
 * Evidence is required per figure, not per form: each semester line is
 * verified separately (0003's `student_semesters.status`), so each one needs
 * its own marksheet or the coordinator cannot verify the lines independently.
 */

import type { ProgrammeLevel } from "./academics";

export type MarksheetKind =
  | "tenth_marksheet"
  | "twelfth_marksheet"
  | "diploma_marksheet"
  | "ug_consolidated_marksheet"
  | "semester_marksheet";

export interface MarksheetSlot {
  /** Stable identity for one document, for form state and uploads. */
  readonly key: string;
  readonly kind: MarksheetKind;
  readonly label: string;
  /** Set on semester marksheets only; null on the whole-qualification ones. */
  readonly semesterNumber: number | null;
  /**
   * Whether the form may be submitted without it.
   *
   * School and semester evidence is required: the semester figure is what R5
   * reads to decide whether a student may apply to a drive, so an unverifiable
   * one is the defect this whole area exists to prevent.
   *
   * The diploma and a postgraduate's consolidated UG marksheet are OFFERED but
   * not demanded (2026-08-06, reversing part of A31). Neither feeds a cutoff.
   */
  readonly required: boolean;
}

/** The academic record the requirement is derived from — nothing else. */
export interface DeclaredAcademics {
  readonly programmeLevel: ProgrammeLevel;
  readonly semesters: readonly { readonly semesterNumber: number }[];
  /**
   * Optional to DECLARE, not optional to evidence (2026-08-06). The moment a
   * diploma figure is on the form it is a mark a coordinator must verify.
   */
  readonly hasDiplomaMarks?: boolean;
}

const FIXED_KEYS: Readonly<Record<Exclude<MarksheetKind, "semester_marksheet">, string>> = {
  tenth_marksheet: "tenth",
  twelfth_marksheet: "twelfth",
  diploma_marksheet: "diploma",
  ug_consolidated_marksheet: "ug_consolidated",
};

export function semesterMarksheetKey(semesterNumber: number): string {
  return `semester-${semesterNumber}`;
}

/**
 * One key derivation, used by the form, the uploader and the reader alike.
 *
 * If these ever disagreed, a file would be stored under one name and looked
 * for under another — and the student would be told their marksheet was
 * missing while it sat in the bucket.
 */
export type MarksheetSlotRef =
  | { readonly kind: "semester_marksheet"; readonly semesterNumber: number }
  | {
      readonly kind: Exclude<MarksheetKind, "semester_marksheet">;
      readonly semesterNumber?: null;
    };

export function marksheetSlotKey(slot: MarksheetSlotRef): string {
  // A semester marksheet cannot be keyed without its number, so the type
  // refuses one rather than this defaulting to "semester-0" - a key that
  // matches no upload and would report a stored marksheet as missing.
  return slot.kind === "semester_marksheet"
    ? semesterMarksheetKey(slot.semesterNumber)
    : FIXED_KEYS[slot.kind];
}

/**
 * Every marksheet the form offers, required or not, in the order it asks for
 * them. `requiredMarksheets` is this list filtered.
 */
export function marksheetSlots(academics: DeclaredAcademics): readonly MarksheetSlot[] {
  const slots: MarksheetSlot[] = [
    {
      key: "tenth",
      kind: "tenth_marksheet",
      label: "10th marksheet",
      semesterNumber: null,
      required: true,
    },
    {
      key: "twelfth",
      kind: "twelfth_marksheet",
      label: "12th marksheet",
      semesterNumber: null,
      required: true,
    },
  ];

  // Between school and the degree, which is where the form asks for it.
  if (academics.hasDiplomaMarks === true) {
    slots.push({
      key: "diploma",
      kind: "diploma_marksheet",
      label: "Diploma marksheet",
      semesterNumber: null,
      required: false,
    });
  }

  // ⚠️ ASSUMPTION — UNCONFIRMED (A31). A postgraduate declares one aggregate
  // CGPA standing in for an entire completed degree (0017). Unevidenced it is
  // the single largest unverifiable figure on the form, so it is treated like
  // any other declared mark: it needs the document that proves it.
  if (academics.programmeLevel === "pg") {
    slots.push({
      key: "ug_consolidated",
      kind: "ug_consolidated_marksheet",
      label: "Consolidated UG marksheet",
      semesterNumber: null,
      required: false,
    });
  }

  // Deduplicated and sorted: `validateSemesters` rejects a repeated number,
  // but the upload list renders while the form is still invalid, and two file
  // inputs for semester 1 would race to write the same evidence.
  const numbers = [...new Set(academics.semesters.map((s) => s.semesterNumber))].sort(
    (a, b) => a - b,
  );

  for (const semesterNumber of numbers) {
    slots.push({
      key: semesterMarksheetKey(semesterNumber),
      kind: "semester_marksheet",
      label: `Semester ${semesterNumber} marksheet`,
      semesterNumber,
      required: true,
    });
  }

  return slots;
}

export function requiredMarksheets(academics: DeclaredAcademics): readonly MarksheetSlot[] {
  return marksheetSlots(academics).filter((slot) => slot.required);
}

/**
 * What is still owed. Matched on key, so a document uploaded for a semester
 * the student has since deleted satisfies nothing.
 */
export function missingMarksheets(
  academics: DeclaredAcademics,
  provided: readonly string[],
): readonly MarksheetSlot[] {
  const have = new Set(provided);
  return requiredMarksheets(academics).filter((slot) => !have.has(slot.key));
}
