import { describe, expect, it } from "vitest";
import { objectKeyIn } from "./storage-path";

/**
 * 2026-08-26 — the recruiter export failed for every drive with
 * "A resume could not be downloaded (…)".
 *
 * `student_documents.storage_path` holds TWO conventions:
 *
 *  - bare `<student>/<file>` — every marksheet, certificate, offer letter and
 *    profile resume, read with `storage.from(<bucket>).download(path)`;
 *  - bucket-prefixed `<bucket>/<student>/<file>` — participation evidence,
 *    which deliberately carries its bucket because ONE column there serves
 *    two buckets, and apply-time resumes, which did it by accident.
 *
 * So the export asked the `resumes` bucket for `resumes/<student>/<file>` and
 * was told, correctly, that no such object exists. Verified live: all 14
 * resume rows were unresolvable — the export had never once worked.
 */
describe("objectKeyIn", () => {
  it("returns a bare path untouched", () => {
    expect(objectKeyIn("resumes", "student-1/cv.pdf")).toBe("student-1/cv.pdf");
  });

  it("strips the bucket a path has been prefixed with", () => {
    expect(objectKeyIn("resumes", "resumes/student-1/cv.pdf")).toBe("student-1/cv.pdf");
  });

  /** One prefix, not every occurrence: a folder may legitimately be named for the bucket. */
  it("strips the prefix once and leaves the rest of the key alone", () => {
    expect(objectKeyIn("resumes", "resumes/student-1/resumes/cv.pdf")).toBe(
      "student-1/resumes/cv.pdf",
    );
  });

  it("does not strip a bucket name that merely starts the first segment", () => {
    expect(objectKeyIn("resumes", "resumes-archive/cv.pdf")).toBe("resumes-archive/cv.pdf");
  });

  it("does not strip a bucket name that appears deeper in the path", () => {
    expect(objectKeyIn("resumes", "student-1/resumes/cv.pdf")).toBe("student-1/resumes/cv.pdf");
  });

  /** Spaces and brackets are ordinary in a filename — "images (6).pdf" is the one that broke. */
  it("keeps a filename exactly as it was uploaded", () => {
    expect(objectKeyIn("resumes", "resumes/s1/0df75ac1-1787027936502-images (6).pdf")).toBe(
      "s1/0df75ac1-1787027936502-images (6).pdf",
    );
  });

  it("refuses to turn a bare bucket name into an empty key", () => {
    expect(objectKeyIn("resumes", "resumes")).toBe("resumes");
    expect(objectKeyIn("resumes", "resumes/")).toBe("resumes/");
  });

  it("passes an empty path straight through rather than inventing one", () => {
    expect(objectKeyIn("resumes", "")).toBe("");
  });
});
