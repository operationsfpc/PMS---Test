/**
 * Files attached to a record by a member of staff.
 *
 * Today that is one file: the recruiter's own job description, attached to the
 * PIF (asked for 2026-08-18). The AE used to retype or paste a fragment of it
 * and the PDF — the thing the recruiter actually wrote and the student
 * actually wants — never entered the system at all.
 *
 * The two limits are stated here because the `job-descriptions` bucket in
 * `0051` enforces exactly the same pair. A browser that let a 30 MB scan
 * through would only discover that after the upload had run, and the AE would
 * be told "could not save the PIF" about a form that was perfectly good.
 */

/**
 * The private, PDF-only bucket `0051` creates. Named here rather than in the
 * PIF feature because the Delivery Head's queue and the student's drive card
 * both read from it, and one feature importing another is refused by
 * `src/architecture.test.ts` — correctly: shared vocabulary belongs in Layer 0.
 */
export const JOB_DESCRIPTION_BUCKET = "job-descriptions";

/** Matches the bucket's `file_size_limit`, which every other bucket shares. */
export const JOB_DESCRIPTION_MAX_BYTES = 5 * 1024 * 1024;

/** Only what a browser actually gives us — deliberately not `File`, so this stays testable. */
export interface AttachedFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

const isPdf = (file: AttachedFile): boolean =>
  file.type === "application/pdf" ||
  // Some browsers hand back an empty `type` (a file dragged from a network
  // share, most often). Refusing on that alone would refuse a real PDF.
  (file.type === "" && file.name.trim().toLowerCase().endsWith(".pdf"));

/**
 * Why this file cannot be attached, or `null` if it can.
 *
 * No file is not a problem: the attachment is optional (answer 1 — the PDF
 * sits BESIDE the typed description rather than replacing it).
 */
export function jobDescriptionFileProblem(file: AttachedFile | null | undefined): string | null {
  if (file === null || file === undefined) return null;
  if (!isPdf(file)) return "The job description must be a PDF.";
  if (file.size <= 0) return "That file is empty. Attach the job description again.";
  if (file.size > JOB_DESCRIPTION_MAX_BYTES) {
    return "The job description must be 5 MB or smaller.";
  }
  return null;
}

/** A size the way a person would say it. Blank when the size is not known. */
export function describeFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Offer letters (spec B, approved 2026-08-24). Answer 1b: PDF + JPG/PNG —
 * letters arrive as documents and as photographed or screenshotted mails.
 * The bucket (0062) enforces exactly the same pair of limits.
 */
export const OFFER_LETTER_BUCKET = "offer-letters";
export const OFFER_LETTER_MAX_BYTES = 5 * 1024 * 1024;

const OFFER_LETTER_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const OFFER_LETTER_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

const isOfferLetterFormat = (file: AttachedFile): boolean =>
  OFFER_LETTER_TYPES.has(file.type) ||
  (file.type === "" &&
    OFFER_LETTER_EXTENSIONS.some((ext) => file.name.trim().toLowerCase().endsWith(ext)));

/** Why this file cannot be attached as an offer letter, or null if it can. */
export function offerLetterFileProblem(file: AttachedFile | null | undefined): string | null {
  if (file === null || file === undefined) return null;
  if (!isOfferLetterFormat(file)) return "The offer letter must be a PDF, JPG or PNG.";
  if (file.size <= 0) return "That file is empty. Attach the offer letter again.";
  if (file.size > OFFER_LETTER_MAX_BYTES) return "The offer letter must be 5 MB or smaller.";
  return null;
}
