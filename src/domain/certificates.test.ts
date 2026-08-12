import { describe, expect, it } from "vitest";
import {
  type CertificateEntry,
  canRemoveCertificate,
  canUploadCertificate,
  certificateStanding,
  decideCertificate,
  usableCertificates,
  validateCertificates,
} from "./certificates";

/**
 * Certificates on the registration form.
 *
 * F17 (UAT 2026-08-06): "The student registration form should also contain an
 * upload button for students to upload the certificates. Name of certificate +
 * upload certificate."
 *
 * F9: "Currently, students can upload certificates multiple times, which
 * should be restricted to a single upload."
 *
 * A certificate is a NAME and a FILE. Either alone is useless: a name with no
 * document is an unverifiable claim, and a document with no name is something
 * a coordinator has to open to identify.
 */
const entry = (over: Partial<CertificateEntry> = {}): CertificateEntry => ({
  name: "AWS Cloud Practitioner",
  hasFile: true,
  ...over,
});

describe("validateCertificates", () => {
  it("accepts a named certificate with its document", () => {
    expect(validateCertificates([entry()])).toEqual([]);
  });

  it("accepts no certificates at all — they are not compulsory", () => {
    expect(validateCertificates([])).toEqual([]);
  });

  it("refuses a document with no name, which nobody can identify without opening it", () => {
    const problems = validateCertificates([entry({ name: "  " })]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/name/i);
  });

  it("refuses a name with no document, which is an unverifiable claim", () => {
    const problems = validateCertificates([entry({ hasFile: false })]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/upload/i);
  });

  /**
   * F9. The same certificate arriving twice is the bug reported: a coordinator
   * verifying a profile has to work out which of three identical rows is the
   * real one, and there is no answer.
   */
  it("refuses the same certificate twice", () => {
    const problems = validateCertificates([entry(), entry()]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/once/i);
  });

  it("treats a name that differs only in case or spacing as the same certificate", () => {
    const problems = validateCertificates([
      entry({ name: "AWS Cloud Practitioner" }),
      entry({ name: "  aws cloud practitioner " }),
    ]);

    expect(problems).toHaveLength(1);
  });

  it("allows genuinely different certificates", () => {
    expect(
      validateCertificates([
        entry({ name: "AWS Cloud Practitioner" }),
        entry({ name: "Azure Fundamentals" }),
      ]),
    ).toEqual([]);
  });

  /** Every problem at once: fixing one per submit is how a student gives up. */
  it("reports every problem in one go", () => {
    const problems = validateCertificates([entry({ name: "" }), entry({ hasFile: false })]);

    expect(problems.length).toBeGreaterThan(1);
  });

  it("names the certificate it is complaining about", () => {
    const problems = validateCertificates([entry({ name: "Azure Fundamentals", hasFile: false })]);

    expect(problems[0]).toMatch(/azure fundamentals/i);
  });
});

/**
 * F9, on the screen: once a certificate is uploaded it is not uploaded again.
 * A student wanting to correct one removes it first, which makes the
 * replacement deliberate rather than a fourth copy.
 */
describe("canUploadCertificate", () => {
  it("allows a certificate that is not on file yet", () => {
    const decision = canUploadCertificate("AWS Cloud Practitioner", ["Azure Fundamentals"]);

    expect(decision.allowed).toBe(true);
  });

  it("refuses one that is already on file", () => {
    const decision = canUploadCertificate("AWS Cloud Practitioner", ["AWS Cloud Practitioner"]);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/already uploaded/i);
  });

  it("compares names the way a human would", () => {
    expect(
      canUploadCertificate(" aws cloud practitioner ", ["AWS Cloud Practitioner"]).allowed,
    ).toBe(false);
  });

  it("refuses an unnamed certificate before asking anything else", () => {
    const decision = canUploadCertificate("   ", []);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/name/i);
  });
});

/** Rows the student added and left blank are dropped, not held against them. */
describe("usableCertificates", () => {
  it("drops a row with neither a name nor a file", () => {
    expect(usableCertificates([entry({ name: "", hasFile: false }), entry()])).toHaveLength(1);
  });

  it("keeps a half-finished row, so the student is told what is missing", () => {
    expect(usableCertificates([entry({ hasFile: false })])).toHaveLength(1);
  });

  it("trims the name it keeps", () => {
    expect(usableCertificates([entry({ name: "  AWS  " })])[0]?.name).toBe("AWS");
  });
});

/**
 * Verification (asked for 2026-08-06).
 *
 * "skill certifications uploaded by students will also need verification of
 * campus placement coordinator similar to CGPA approval. This is applicable
 * for first upload as well as subsequent additions."
 *
 * A certificate is a claim until a coordinator has opened the document and
 * agreed it says what the name says. Same standing as a declared CGPA: the
 * student states it, the coordinator confirms it against the evidence.
 *
 * Unlike a CGPA, a certificate can arrive at ANY time - the profile page
 * accepts one the day after approval - so this is decided per certificate
 * rather than bundled into the registration form's approval. One mechanism
 * covers the first upload and every later one, which is what was asked for.
 */
describe("decideCertificate", () => {
  it("verifies a pending certificate", () => {
    expect(decideCertificate("pending", { decision: "verify" })).toEqual({
      ok: true,
      next: "verified",
    });
  });

  it("rejects a pending certificate with a reason", () => {
    expect(decideCertificate("pending", { decision: "reject", reason: "Not legible" })).toEqual({
      ok: true,
      next: "rejected",
    });
  });

  /** F1's rule, and for the same reason: it is all the student is told. */
  it("refuses a rejection with no reason", () => {
    expect(decideCertificate("pending", { decision: "reject", reason: "   " })).toEqual({
      ok: false,
      error: "A rejection needs a reason, so the student knows what to correct.",
    });
  });

  it("refuses to re-decide a certificate that was already verified", () => {
    expect(
      decideCertificate("verified", { decision: "reject", reason: "Changed my mind" }),
    ).toEqual({
      ok: false,
      error: "This certificate has already been decided.",
    });
  });

  it("refuses to re-decide a certificate that was already rejected", () => {
    expect(decideCertificate("rejected", { decision: "verify" })).toEqual({
      ok: false,
      error: "This certificate has already been decided.",
    });
  });
});

describe("canRemoveCertificate", () => {
  it("lets a student remove one that is still pending", () => {
    expect(canRemoveCertificate("pending")).toEqual({ allowed: true });
  });

  /** How a student replaces a certificate the coordinator would not accept. */
  it("lets a student remove one that was rejected", () => {
    expect(canRemoveCertificate("rejected")).toEqual({ allowed: true });
  });

  /**
   * Q4, applied to certificates: verified data is no longer the student's to
   * change. Removing one would also destroy the coordinator's own record of
   * having checked it.
   */
  it("refuses to let a student remove a verified certificate", () => {
    expect(canRemoveCertificate("verified")).toEqual({
      allowed: false,
      reason:
        "This certificate has been verified. Ask your placement coordinator if it needs to change.",
    });
  });
});

describe("certificateStanding", () => {
  it("tells a student their certificate is waiting to be checked", () => {
    expect(certificateStanding("pending", null)).toEqual({
      label: "Awaiting verification",
      reason: null,
    });
  });

  it("tells a student their certificate was verified", () => {
    expect(certificateStanding("verified", null)).toEqual({ label: "Verified", reason: null });
  });

  it("gives a rejected certificate its reason, which is the point of rejecting it", () => {
    expect(certificateStanding("rejected", "The name does not match the document")).toEqual({
      label: "Not accepted",
      reason: "The name does not match the document",
    });
  });

  it("still reads as not accepted when the reason was lost", () => {
    expect(certificateStanding("rejected", null)).toEqual({ label: "Not accepted", reason: null });
  });
});
