import { describe, expect, it } from "vitest";
import {
  type CertificateEntry,
  canUploadCertificate,
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
