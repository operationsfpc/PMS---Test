import { describe, expect, it } from "vitest";
import {
  describeFileSize,
  JOB_DESCRIPTION_MAX_BYTES,
  jobDescriptionFileProblem,
  OFFER_LETTER_MAX_BYTES,
  offerLetterFileProblem,
} from "./attachments";

/**
 * The recruiter's own JD, attached to the PIF (asked for 2026-08-18).
 *
 * The rule lives here because the storage bucket in `0051` enforces the same
 * two limits (PDF, 5 MB) and a browser that let a 30 MB scan through would
 * only find that out after the upload had run.
 */
describe("jobDescriptionFileProblem", () => {
  const pdf = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
    name: "jd.pdf",
    size: 412_000,
    type: "application/pdf",
    ...over,
  });

  it("accepts a PDF within the limit", () => {
    expect(jobDescriptionFileProblem(pdf())).toBeNull();
  });

  it("accepts no file at all — the attachment is optional", () => {
    expect(jobDescriptionFileProblem(null)).toBeNull();
    expect(jobDescriptionFileProblem(undefined)).toBeNull();
  });

  it("refuses anything that is not a PDF", () => {
    expect(jobDescriptionFileProblem(pdf({ name: "jd.docx", type: "application/msword" }))).toBe(
      "The job description must be a PDF.",
    );
    expect(jobDescriptionFileProblem(pdf({ name: "jd.png", type: "image/png" }))).toBe(
      "The job description must be a PDF.",
    );
  });

  it("trusts the extension when the browser offers no type", () => {
    // Some browsers hand back an empty `type` for a file dragged in from a
    // network share. Refusing it would refuse a real PDF.
    expect(jobDescriptionFileProblem(pdf({ type: "" }))).toBeNull();
    expect(jobDescriptionFileProblem(pdf({ name: "JD.PDF", type: "" }))).toBeNull();
    expect(jobDescriptionFileProblem(pdf({ name: "jd", type: "" }))).toBe(
      "The job description must be a PDF.",
    );
  });

  it("refuses an empty file", () => {
    // A 0-byte upload is a failed download from the recruiter's mail, and it
    // would reach the student as a link that opens nothing.
    expect(jobDescriptionFileProblem(pdf({ size: 0 }))).toBe(
      "That file is empty. Attach the job description again.",
    );
  });

  it("refuses a file over the bucket's limit, and says what the limit is", () => {
    expect(jobDescriptionFileProblem(pdf({ size: JOB_DESCRIPTION_MAX_BYTES + 1 }))).toBe(
      "The job description must be 5 MB or smaller.",
    );
    expect(jobDescriptionFileProblem(pdf({ size: JOB_DESCRIPTION_MAX_BYTES }))).toBeNull();
  });
});

describe("describeFileSize", () => {
  it("reads a size the way a person would say it", () => {
    expect(describeFileSize(0)).toBe("0 KB");
    expect(describeFileSize(900)).toBe("1 KB");
    expect(describeFileSize(412_000)).toBe("402 KB");
    expect(describeFileSize(5_242_880)).toBe("5.0 MB");
    expect(describeFileSize(1_572_864)).toBe("1.5 MB");
  });

  it("says nothing it does not know", () => {
    expect(describeFileSize(null)).toBe("");
    expect(describeFileSize(undefined)).toBe("");
  });
});

/**
 * Spec B (approved 2026-08-24, answer 1b): offer letters arrive as PDFs and
 * as photographed or screenshotted mails — so JPG/PNG are welcome too.
 */
describe("offerLetterFileProblem", () => {
  const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
    name: "letter.pdf",
    size: 100_000,
    type: "application/pdf",
    ...over,
  });

  it("accepts a PDF, a JPG and a PNG", () => {
    expect(offerLetterFileProblem(file())).toBeNull();
    expect(offerLetterFileProblem(file({ name: "l.jpg", type: "image/jpeg" }))).toBeNull();
    expect(offerLetterFileProblem(file({ name: "l.png", type: "image/png" }))).toBeNull();
  });

  it("accepts nothing at all — the attachment is optional", () => {
    expect(offerLetterFileProblem(null)).toBeNull();
    expect(offerLetterFileProblem(undefined)).toBeNull();
  });

  it("refuses other formats by name", () => {
    expect(offerLetterFileProblem(file({ name: "l.docx", type: "application/msword" }))).toMatch(
      /pdf, jpg or png/i,
    );
  });

  it("refuses an empty file and an oversized one", () => {
    expect(offerLetterFileProblem(file({ size: 0 }))).toMatch(/empty/i);
    expect(offerLetterFileProblem(file({ size: OFFER_LETTER_MAX_BYTES + 1 }))).toMatch(/5 MB/);
    expect(offerLetterFileProblem(file({ size: OFFER_LETTER_MAX_BYTES }))).toBeNull();
  });

  it("trusts the extension when the browser gives no type", () => {
    expect(offerLetterFileProblem(file({ name: "L.JPG", type: "" }))).toBeNull();
    expect(offerLetterFileProblem(file({ name: "letter", type: "" }))).toMatch(/pdf, jpg or png/i);
  });
});
