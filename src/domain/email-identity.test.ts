import { describe, expect, it } from "vitest";
import { type EmailHolder, emailClash, normaliseEmail } from "./email-identity";

/**
 * One email identifies one person (asked for 2026-08-06).
 *
 * "can you block an email id from being entered twice? student + student as
 * well as student+staff"
 *
 * This is the root cause of P8, not a tidiness rule. `sainaveen@faceprep.in`
 * was on the student roster AND a staff profile, on one Google account. Sign-in
 * is by email, so one address is one identity - and the guard that stops a
 * student editing verified academic data (0009) identifies students by exactly
 * that. The dual identity made the only campus coordinator unable to approve
 * any registration form, and would have let them verify their own certificates.
 *
 * A staff INVITATION and the PROFILE it becomes are one person, not two, so
 * they are never a clash. That pair is the normal state of every staff member.
 */

const taken = (entries: Array<[string, EmailHolder]>): ReadonlyMap<string, EmailHolder> =>
  new Map(entries.map(([email, holder]) => [normaliseEmail(email), holder]));

describe("normaliseEmail", () => {
  it("trims and lowercases, because a login is not case-sensitive", () => {
    expect(normaliseEmail("  Priya@Gmail.COM ")).toBe("priya@gmail.com");
  });

  it("leaves an already-canonical address alone", () => {
    expect(normaliseEmail("priya@gmail.com")).toBe("priya@gmail.com");
  });
});

describe("emailClash", () => {
  it("allows an address nobody holds", () => {
    expect(emailClash("new@faceprep.in", taken([]), "student")).toBeNull();
  });

  it("refuses a second student on the same address", () => {
    expect(emailClash("priya@gmail.com", taken([["priya@gmail.com", "student"]]), "student")).toBe(
      "priya@gmail.com is already on the student roster.",
    );
  });

  it("refuses a student whose address belongs to a staff account", () => {
    expect(
      emailClash("sainaveen@faceprep.in", taken([["sainaveen@faceprep.in", "staff"]]), "student"),
    ).toBe(
      "sainaveen@faceprep.in is already a staff account. One person is either a student or staff, never both — use a different address.",
    );
  });

  it("refuses staff whose address is on the student roster", () => {
    expect(
      emailClash("sainaveen@faceprep.in", taken([["sainaveen@faceprep.in", "student"]]), "staff"),
    ).toBe(
      "sainaveen@faceprep.in is already on the student roster. One person is either a student or staff, never both — use a different address.",
    );
  });

  it("refuses inviting the same staff member twice", () => {
    expect(emailClash("ashok@faceprep.in", taken([["ashok@faceprep.in", "staff"]]), "staff")).toBe(
      "ashok@faceprep.in has already been invited.",
    );
  });

  /** The whole point: a login is not case-sensitive, so neither is this. */
  it("catches a clash that differs only by case or spacing", () => {
    expect(
      emailClash(
        "  SaiNaveen@FacePrep.in ",
        taken([["sainaveen@faceprep.in", "staff"]]),
        "student",
      ),
    ).toContain("already a staff account");
  });

  it("names the address as the person typed it would be stored", () => {
    expect(
      emailClash("  PRIYA@GMAIL.COM ", taken([["priya@gmail.com", "student"]]), "student"),
    ).toBe("priya@gmail.com is already on the student roster.");
  });
});
