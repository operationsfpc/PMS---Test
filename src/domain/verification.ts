/**
 * Whether a verification decision has anything behind it.
 *
 * 2026-10-18 (UAT): four coordinator queues say "No document uploaded" on a row
 * and then offer Verify beside the sentence — so a click endorses a figure the
 * student typed, which is the one thing these screens exist to prevent. The
 * wording lives here rather than on each queue because two screens describing
 * the same missing file must not be able to disagree about what is missing.
 */

/** Why this row cannot be verified — or null when the document is there. */
export function evidenceProblem(hasDocument: boolean): string | null {
  return hasDocument
    ? null
    : "There is no document to check against, so nothing can be verified yet.";
}

/** One thing a form claims, and whether the document behind it was found. */
export type EvidenceClaim = {
  readonly label: string;
  readonly hasDocument: boolean;
};

/**
 * Why a whole form cannot be approved — or null when every claim has its file.
 *
 * Approving a registration form is not one status flip. It verifies every
 * declared semester (0031) and every pending certificate (0039) as a side
 * effect, so a figure with no marksheet behind it would be marked verified on
 * the strength of the student's own typing. The screen lists what is missing
 * rather than counting it, because a coordinator's next move is to ask for
 * that one file — not to guess which of eight semesters they are missing.
 */
export function describeUncheckedClaims(claims: readonly EvidenceClaim[]): string | null {
  const missing = claims
    .filter((claim) => !claim.hasDocument && claim.label.trim() !== "")
    .map((claim) => claim.label.trim());

  if (missing.length === 0) return null;
  const pronoun = missing.length === 1 ? "it" : "them";
  return `Nothing to check against: ${missing.join(", ")}. Approving would confirm ${pronoun} on the student's own typing.`;
}
