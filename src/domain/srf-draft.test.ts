import { describe, expect, it } from "vitest";
import { mergeSrfDraft, srfValuesFromSubmitted } from "./srf-draft";

/**
 * Resuming a saved registration form.
 *
 * The rule that matters: IDENTITY ALWAYS COMES FROM THE ROSTER, never from the
 * draft. A draft can be weeks old and the college may have corrected a roll
 * number or a branch since. Letting a stale draft win would quietly restore
 * the old value and send it for verification, where it fails against the
 * marksheet - and the student is blamed for it.
 *
 * Everything else is the student's own work and is restored exactly.
 */
const DEFAULTS = {
  fullName: "",
  rollNumber: "",
  email: "",
  degree: "",
  branch: "",
  passingYear: Number.NaN,
  mobile: "",
  technicalSkills: "",
};

const ROSTER = {
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
};

describe("mergeSrfDraft", () => {
  it("restores what the student had typed", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      mobile: "9876543210",
      technicalSkills: "TypeScript",
    });

    expect(merged.mobile).toBe("9876543210");
    expect(merged.technicalSkills).toBe("TypeScript");
  });

  it("takes identity from the roster, not from the draft", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      rollNumber: "OLD-ROLL",
      branch: "ECE",
      fullName: "Old Name",
      passingYear: 2025,
    });

    expect(merged.rollNumber).toBe("21CSE1042");
    expect(merged.branch).toBe("CSE");
    expect(merged.fullName).toBe("Asha Rao");
    expect(merged.passingYear).toBe(2026);
  });

  it("falls back to the defaults for anything neither has", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, { mobile: "9876543210" });

    expect(merged.technicalSkills).toBe("");
  });

  it("returns the roster-prefilled form when there is no draft", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, null);

    expect(merged.fullName).toBe("Asha Rao");
    expect(merged.mobile).toBe("");
  });

  it("survives a student with no roster record at all", () => {
    const merged = mergeSrfDraft(DEFAULTS, null, { mobile: "9876543210" });

    expect(merged.mobile).toBe("9876543210");
    expect(merged.fullName).toBe("");
  });

  it("ignores a draft that is not an object, rather than crashing the form", () => {
    for (const junk of ["nonsense", 42, [], null]) {
      expect(mergeSrfDraft(DEFAULTS, ROSTER, junk as never).fullName).toBe("Asha Rao");
    }
  });

  /**
   * A draft written by an older version of the form can carry fields that no
   * longer exist. They must not travel into the form state, where they would
   * be submitted and rejected by the schema.
   */
  it("drops keys the form no longer has", () => {
    const merged = mergeSrfDraft(DEFAULTS, ROSTER, {
      mobile: "9876543210",
      overallCgpa: 8.2,
    } as never);

    expect(merged).not.toHaveProperty("overallCgpa");
  });

  /**
   * Some degrees have no branch at all (A11), so the roster record legitimately
   * arrives with the field missing. Writing `undefined` over the default would
   * turn a controlled input into an uncontrolled one mid-render.
   */
  it("leaves a field the roster does not have alone", () => {
    const merged = mergeSrfDraft(DEFAULTS, { ...ROSTER, branch: undefined }, {
      branch: "ECE",
    } as never);

    expect(merged.branch).toBe("ECE");
  });

  it("does not mutate the defaults it was given", () => {
    const defaults = { ...DEFAULTS };
    mergeSrfDraft(defaults, ROSTER, { mobile: "9876543210" });

    expect(defaults.mobile).toBe("");
  });
});

/**
 * A File cannot survive a draft.
 *
 * `JSON.stringify` turns one into `{}`, so a draft written while the student
 * had picked their marksheets comes back as `{"tenth": {}}` — keys present,
 * files gone. Restoring that would count the evidence as provided, mark the
 * section complete, and let a form reach the coordinator with marks nobody can
 * check against anything. Uploads are re-picked, deliberately.
 */
describe("uploads are never restored from a draft", () => {
  it("drops marksheets a draft claims to carry", () => {
    const merged = mergeSrfDraft({ mobile: "", marksheets: {} }, null, {
      mobile: "9876543210",
      marksheets: { tenth: {}, twelfth: {} },
    });

    expect(merged.marksheets).toEqual({});
    // Everything else in the same draft is still restored.
    expect(merged.mobile).toBe("9876543210");
  });
});

/**
 * A form sent back for changes must come back FILLED IN (2026-08-18).
 *
 * `submit_srf` nulls `srf_draft`, and the page merged roster identity and a
 * draft only - so a rejected student opened a blank form and retyped every
 * mark, school and phone number. "Edit and resubmit" was "fill it in again",
 * and a student retyping a figure they cannot see is a student who mistypes it.
 */
describe("srfValuesFromSubmitted", () => {
  const SUBMITTED = {
    mobile: "9876543210",
    whatsapp: null,
    alternateContact: "9123456780",
    tenthInstitution: "Vidya Mandir",
    tenthPercentage: 91.4,
    tenthBoard: "state_board",
    tenthBoardState: "Tamil Nadu",
    tenthBoardOther: null,
    twelfthInstitution: "Sri Chaitanya",
    twelfthPercentage: 88,
    twelfthBoard: "cbse",
    twelfthBoardState: null,
    twelfthBoardOther: null,
    diplomaInstitution: null,
    diplomaUniversity: null,
    diplomaMarks: null,
    diplomaMarksScale: null,
    programmeLevel: "pg",
    marksScale: "percentage",
    ugDegree: "B.Sc",
    ugCollege: "PSG",
    ugBranch: "Computer Science",
    ugAggregate: 72.5,
    ugAggregateScale: "percentage",
    technicalSkills: "React, SQL",
    areasOfInterest: "Backend",
    areasOfExpertise: "",
    projects: "A thing I built",
    achievements: null,
    linkedin: "https://linkedin.com/in/asha",
    github: null,
    leetcode: null,
    hackerrank: null,
    otherProfiles: [{ label: "Kaggle", value: "kaggle.com/asha" }],
    semesters: [
      { semesterNumber: 1, marks: 74, currentArrears: 0, historyOfArrears: 1 },
      { semesterNumber: 2, marks: 78, currentArrears: 0, historyOfArrears: 1 },
    ],
  } as const;

  it("gives back every figure the student declared", () => {
    const values = srfValuesFromSubmitted(SUBMITTED);

    expect(values.tenthPercentage).toBe(91.4);
    expect(values.twelfthPercentage).toBe(88);
    expect(values.tenthInstitution).toBe("Vidya Mandir");
    expect(values.mobile).toBe("9876543210");
    expect(values.alternateContact).toBe("9123456780");
  });

  it("gives back the boards, including the state that identifies one", () => {
    const values = srfValuesFromSubmitted(SUBMITTED);

    expect(values.tenthBoard).toBe("state_board");
    expect(values.tenthBoardState).toBe("Tamil Nadu");
    expect(values.twelfthBoard).toBe("cbse");
    expect(values.twelfthBoardState).toBe("");
  });

  it("gives back the semester lines, in order, with their arrears", () => {
    expect(srfValuesFromSubmitted(SUBMITTED).semesters).toEqual([
      { semesterNumber: 1, marks: 74, currentArrears: 0, historyOfArrears: 1 },
      { semesterNumber: 2, marks: 78, currentArrears: 0, historyOfArrears: 1 },
    ]);
  });

  /**
   * The scale is one answer for the whole degree, and every semester figure
   * was declared on it. Losing it would show a 74% as a CGPA of 74 and the
   * schema would refuse the resubmission on a field the student never touched.
   */
  it("gives back the scale the figures were declared on", () => {
    expect(srfValuesFromSubmitted(SUBMITTED).collegeMarksScale).toBe("percentage");
  });

  it("gives back the completed UG degree for a postgraduate", () => {
    const values = srfValuesFromSubmitted(SUBMITTED);

    expect(values.programmeLevel).toBe("pg");
    expect(values.ugCollege).toBe("PSG");
    expect(values.ugAggregate).toBe(72.5);
    expect(values.ugAggregateScale).toBe("percentage");
  });

  it("turns every absent value into what the form expects, never undefined", () => {
    const values = srfValuesFromSubmitted(SUBMITTED);

    // Text the student left blank comes back as an empty string: `undefined`
    // in a controlled input makes React switch it to uncontrolled mid-render.
    expect(values.whatsapp).toBe("");
    expect(values.github).toBe("");
    expect(values.achievements).toBe("");
    // A figure they legitimately do not have stays null - "no diploma" and
    // "unreadable" must not collapse into the same answer.
    expect(values.diplomaMarks).toBeNull();
    expect(values.diplomaInstitution).toBe("");
    expect(values.diplomaUniversity).toBe("");
  });

  it("gives back the named profiles, both halves", () => {
    expect(srfValuesFromSubmitted(SUBMITTED).otherProfiles).toEqual([
      { label: "Kaggle", value: "kaggle.com/asha" },
    ]);
  });

  /**
   * The same reason a draft may not carry them: a File does not survive the
   * round trip, and a restored key with no file behind it would count as
   * evidence provided and let unevidenced marks reach the coordinator.
   */
  it("never claims to restore an upload", () => {
    expect(srfValuesFromSubmitted(SUBMITTED).marksheets).toEqual({});
    expect(srfValuesFromSubmitted(SUBMITTED).certificates).toEqual([]);
  });

  it("never restores consent - consenting again is the point of resubmitting", () => {
    expect(srfValuesFromSubmitted(SUBMITTED).consent).toBe(false);
  });

  it("survives a record with nothing on it at all", () => {
    const values = srfValuesFromSubmitted({});

    expect(values.mobile).toBe("");
    expect(values.tenthBoard).toBe("");
  });

  /**
   * Found by a failing form test, and it is a real rule rather than a
   * convenience: every key here OVERWRITES the form's default, and the default
   * is one blank semester line. Handing back `[]` left the student with no line
   * to type into and an "add at least one semester" error on a form they had not
   * touched.
   */
  it("omits the semester list entirely when there is none, rather than emptying the form", () => {
    expect("semesters" in srfValuesFromSubmitted({})).toBe(false);
    expect("semesters" in srfValuesFromSubmitted({ semesters: [] })).toBe(false);
  });

  /**
   * A draft is NEWER than the submission it followed - the student saved it
   * after being sent back. Merging the submission over it would throw away
   * the correction they had already started typing.
   */
  it("is overridden by a real draft, and never overrides the roster", () => {
    const merged = mergeSrfDraft(
      { mobile: "", rollNumber: "", tenthInstitution: "" },
      { rollNumber: "21CSE1042" },
      { ...srfValuesFromSubmitted(SUBMITTED), mobile: "9000000000" },
    );

    expect(merged.mobile).toBe("9000000000");
    expect(merged.tenthInstitution).toBe("Vidya Mandir");
    expect(merged.rollNumber).toBe("21CSE1042");
  });
});
