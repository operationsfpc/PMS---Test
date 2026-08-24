import { describe, expect, it } from "vitest";
import {
  academicStandingFrom,
  addableSemesters,
  canAddLaterSemester,
  decideSemester,
  latestVerifiedSemester,
  MAX_SEMESTERS,
  maxSemestersFor,
  nextSemesterFor,
  type SemesterRecord,
  validateSemesters,
} from "./academics";

/**
 * Semester-wise academics. Confirmed 2026-08-04.
 *
 * A student pursuing UG records one line per semester, up to 10. A student
 * pursuing PG records a single aggregate for their completed UG, then one line
 * per PG semester, up to 4.
 *
 * The rule that matters most: eligibility is judged on the LATEST VERIFIED
 * semester, never on the latest entered. A student types their own marks, so
 * an unverified figure deciding whether they may apply to a drive would let
 * anyone qualify for anything by typing 10.
 */
const sem = (over: Partial<SemesterRecord> & { semesterNumber: number }): SemesterRecord => ({
  cgpa: 8,
  currentArrears: 0,
  historyOfArrears: 0,
  verified: true,
  ...over,
});

describe("maxSemestersFor", () => {
  it("allows ten semesters for an undergraduate", () => {
    expect(maxSemestersFor("ug")).toBe(10);
    expect(MAX_SEMESTERS.ug).toBe(10);
  });

  it("allows four for a postgraduate", () => {
    expect(maxSemestersFor("pg")).toBe(4);
    expect(MAX_SEMESTERS.pg).toBe(4);
  });
});

describe("latestVerifiedSemester", () => {
  it("is the highest semester number that has been verified", () => {
    const found = latestVerifiedSemester([
      sem({ semesterNumber: 1, cgpa: 7 }),
      sem({ semesterNumber: 3, cgpa: 9 }),
      sem({ semesterNumber: 2, cgpa: 8 }),
    ]);

    expect(found?.semesterNumber).toBe(3);
    expect(found?.cgpa).toBe(9);
  });

  /** The whole point: a student cannot promote themselves by typing. */
  it("ignores a later semester that nobody has verified", () => {
    const found = latestVerifiedSemester([
      sem({ semesterNumber: 4, cgpa: 6.2 }),
      sem({ semesterNumber: 5, cgpa: 10, verified: false }),
    ]);

    expect(found?.semesterNumber).toBe(4);
    expect(found?.cgpa).toBe(6.2);
  });

  it("is null when nothing has been verified yet", () => {
    expect(latestVerifiedSemester([sem({ semesterNumber: 1, verified: false })])).toBeNull();
  });

  it("is null when there are no semesters at all", () => {
    expect(latestVerifiedSemester([])).toBeNull();
  });
});

describe("academicStandingFrom", () => {
  it("takes CGPA and both arrear counts from that same semester", () => {
    const standing = academicStandingFrom([
      sem({ semesterNumber: 1, cgpa: 9, currentArrears: 0, historyOfArrears: 0 }),
      sem({ semesterNumber: 2, cgpa: 7.4, currentArrears: 2, historyOfArrears: 3 }),
    ]);

    expect(standing).toEqual({ cgpa: 7.4, currentArrears: 2, historyOfArrears: 3 });
  });

  /**
   * Not zero. Zero is a real CGPA and would silently fail every cutoff while
   * looking like an answer; null forces the caller to treat "not yet verified"
   * as its own case.
   */
  it("is null when no semester has been verified", () => {
    expect(academicStandingFrom([sem({ semesterNumber: 1, verified: false })])).toBeNull();
  });
});

describe("validateSemesters", () => {
  it("accepts a well-formed undergraduate record", () => {
    expect(
      validateSemesters("ug", [sem({ semesterNumber: 1 }), sem({ semesterNumber: 2 })]),
    ).toEqual([]);
  });

  it("refuses more semesters than the programme has", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => sem({ semesterNumber: i + 1 }));

    expect(validateSemesters("ug", eleven)).toContain("An undergraduate has at most 10 semesters.");
  });

  it("refuses a fifth postgraduate semester", () => {
    const five = Array.from({ length: 5 }, (_, i) => sem({ semesterNumber: i + 1 }));

    expect(validateSemesters("pg", five)).toContain("A postgraduate has at most 4 semesters.");
  });

  it("refuses a semester number outside the programme's range", () => {
    expect(validateSemesters("pg", [sem({ semesterNumber: 5 })])).toContain(
      "Semester 5 is outside the range for this programme.",
    );
    expect(validateSemesters("ug", [sem({ semesterNumber: 0 })])).toContain(
      "Semester 0 is outside the range for this programme.",
    );
  });

  it("refuses the same semester twice", () => {
    expect(
      validateSemesters("ug", [sem({ semesterNumber: 2 }), sem({ semesterNumber: 2 })]),
    ).toContain("Semester 2 appears more than once.");
  });

  it("refuses a CGPA off the 10-point scale, because it is not a GPA", () => {
    expect(validateSemesters("ug", [sem({ semesterNumber: 1, cgpa: 4 })])).toEqual([]);
    expect(validateSemesters("ug", [sem({ semesterNumber: 1, cgpa: 10.5 })])).toContain(
      "Semester 1: CGPA is on a 10-point scale.",
    );
    expect(validateSemesters("ug", [sem({ semesterNumber: 1, cgpa: -1 })])).toContain(
      "Semester 1: CGPA is on a 10-point scale.",
    );
  });

  it("refuses negative arrears", () => {
    expect(validateSemesters("ug", [sem({ semesterNumber: 1, currentArrears: -1 })])).toContain(
      "Semester 1: arrears cannot be negative.",
    );
    expect(validateSemesters("ug", [sem({ semesterNumber: 1, historyOfArrears: -2 })])).toContain(
      "Semester 1: arrears cannot be negative.",
    );
  });

  /** History includes cleared backlogs, so it can never be the smaller number. */
  it("refuses a history of arrears below the standing count", () => {
    expect(
      validateSemesters("ug", [sem({ semesterNumber: 1, currentArrears: 3, historyOfArrears: 1 })]),
    ).toContain("Semester 1: history of arrears cannot be less than current arrears.");
  });

  it("reports every problem at once rather than one at a time", () => {
    const problems = validateSemesters("ug", [
      sem({ semesterNumber: 1, cgpa: 12 }),
      sem({ semesterNumber: 1, currentArrears: -1 }),
    ]);

    expect(problems.length).toBeGreaterThan(2);
  });
});

/**
 * F13 (UAT 2026-08-06): "there has to be a '+' button for students to add
 * their semesters and the marks against those semesters, however, these marks
 * have to be verified. This is required, as students might get subsequent
 * semester results after they have registered to placements ... But this
 * should be visible only after approval from Campus PC."
 *
 * Results arrive after registration. The form locks on approval (srfAccess),
 * for good reason — a student editing a verified record silently invalidates
 * every shortlist it has been judged for — so ADDING a later semester is a
 * separate, narrower permission from editing the form.
 */
describe("canAddLaterSemester", () => {
  const declared = [1, 2, 3, 4];

  it("lets an approved student add the semester after their last", () => {
    const decision = canAddLaterSemester({
      srfStatus: "srf_approved",
      programmeLevel: "ug",
      declaredSemesters: declared,
      semesterNumber: 5,
    });

    expect(decision.allowed).toBe(true);
  });

  /**
   * Adding is not editing. A semester already declared has been checked
   * against a marksheet, and replacing it here would route around the
   * coordinator entirely.
   */
  it("refuses to re-declare a semester that already exists", () => {
    const decision = canAddLaterSemester({
      srfStatus: "srf_approved",
      programmeLevel: "ug",
      declaredSemesters: declared,
      semesterNumber: 3,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/already/i);
  });

  /** Results arrive in order. Semester 7 before 6 means one of them is wrong. */
  it("refuses to skip a semester", () => {
    const decision = canAddLaterSemester({
      srfStatus: "srf_approved",
      programmeLevel: "ug",
      declaredSemesters: declared,
      semesterNumber: 7,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/semester 5/i);
  });

  it("refuses to go past the end of the programme", () => {
    // Ten for an undergraduate, per MAX_SEMESTERS.
    const decision = canAddLaterSemester({
      srfStatus: "srf_approved",
      programmeLevel: "ug",
      declaredSemesters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      semesterNumber: 11,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/10 semesters/i);
  });

  it("respects a postgraduate's shorter programme", () => {
    const decision = canAddLaterSemester({
      srfStatus: "srf_approved",
      programmeLevel: "pg",
      declaredSemesters: [1, 2, 3, 4],
      semesterNumber: 5,
    });

    expect(decision.allowed).toBe(false);
  });

  /**
   * Before approval the form itself is the place to add a semester. Offering
   * two ways in would let a student add one while the coordinator is
   * comparing the list to their marksheets.
   */
  it("refuses while the form is still being verified", () => {
    const decision = canAddLaterSemester({
      srfStatus: "srf_submitted",
      programmeLevel: "ug",
      declaredSemesters: declared,
      semesterNumber: 5,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/verified|approved/i);
  });

  it("refuses on a form that was never submitted", () => {
    expect(
      canAddLaterSemester({
        srfStatus: "registered",
        programmeLevel: "ug",
        declaredSemesters: [],
        semesterNumber: 1,
      }).allowed,
    ).toBe(false);
  });

  it("refuses on a form that was sent back", () => {
    expect(
      canAddLaterSemester({
        srfStatus: "srf_rejected",
        programmeLevel: "ug",
        declaredSemesters: declared,
        semesterNumber: 5,
      }).allowed,
    ).toBe(false);
  });

  it("names the semester the student may add next", () => {
    expect(nextSemesterFor({ programmeLevel: "ug", declaredSemesters: [1, 2, 3] })).toBe(4);
  });

  it("starts at semester 1 when nothing has been declared", () => {
    expect(nextSemesterFor({ programmeLevel: "ug", declaredSemesters: [] })).toBe(1);
  });

  /** Nothing left to add: the screen shows no "+" rather than a dead one. */
  it("names no next semester once the programme is complete", () => {
    expect(nextSemesterFor({ programmeLevel: "pg", declaredSemesters: [1, 2, 3, 4] })).toBeNull();
  });

  it("counts from the highest declared, not from how many there are", () => {
    expect(nextSemesterFor({ programmeLevel: "ug", declaredSemesters: [1, 3] })).toBe(4);
  });
});

/**
 * More than one semester at a time (2026-08-06): "while adding additional
 * semester marks, have option to upload for multiple additional semesters. up
 * to total of 10 for UG and up to total of 4 for PG."
 *
 * A student who registered in their third year and comes back after two more
 * results had to add one semester, wait, and start again. The cap is the same
 * cap as everywhere else - 10 for an undergraduate, 4 for a postgraduate,
 * counted as a TOTAL including what is already on the record.
 */
describe("addableSemesters", () => {
  it("offers every semester left in the programme, in order", () => {
    expect(addableSemesters({ programmeLevel: "ug", declaredSemesters: [1, 2, 3, 4] })).toEqual([
      5, 6, 7, 8, 9, 10,
    ]);
  });

  it("caps a postgraduate at four in total", () => {
    expect(addableSemesters({ programmeLevel: "pg", declaredSemesters: [1, 2] })).toEqual([3, 4]);
  });

  it("offers the whole programme when nothing has been declared", () => {
    expect(addableSemesters({ programmeLevel: "ug", declaredSemesters: [] })).toHaveLength(10);
  });

  it("offers nothing once the programme is complete", () => {
    expect(addableSemesters({ programmeLevel: "pg", declaredSemesters: [1, 2, 3, 4] })).toEqual([]);
  });

  /** Same reason as `nextSemesterFor`: a gap is somebody's to explain. */
  it("counts from the highest declared, so a gap is never re-offered", () => {
    expect(addableSemesters({ programmeLevel: "pg", declaredSemesters: [1, 3] })).toEqual([4]);
  });
});

/**
 * Semester (CGPA) verification — 2026-08-24 UAT: "add request by students for
 * cgpa which has to be approved by campus placement coordinator is not
 * showing up for approval. similar request for certifications is showing up."
 *
 * A semester added AFTER the registration form was approved (F13) sat
 * `pending` forever: 0031 verifies semesters only at SRF approval, and no
 * queue existed. The decision rule mirrors `decideCertificate` — a declared
 * CGPA is a claim until the coordinator has compared it to the marksheet.
 */
describe("decideSemester", () => {
  it("verifies a pending semester", () => {
    expect(decideSemester("pending", { decision: "verify" })).toEqual({
      ok: true,
      next: "verified",
    });
  });

  it("rejects a pending semester, reason required", () => {
    expect(decideSemester("pending", { decision: "reject", reason: "Marksheet says 6.9" })).toEqual(
      { ok: true, next: "rejected" },
    );

    const refused = decideSemester("pending", { decision: "reject", reason: "  " });
    expect(refused.ok).toBe(false);
  });

  it("refuses to re-decide a decided semester", () => {
    expect(decideSemester("verified", { decision: "verify" }).ok).toBe(false);
    expect(decideSemester("rejected", { decision: "verify" }).ok).toBe(false);
  });
});
