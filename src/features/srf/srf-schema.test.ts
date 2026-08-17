import { describe, expect, it } from "vitest";
import { SRF_DEFAULTS, type SrfFormValues, srfSchema } from "./srf-schema";

/** A picked file, as the browser hands it to us. */
const file = (name: string) => new File(["scan"], name, { type: "application/pdf" });

const valid: SrfFormValues = {
  ...SRF_DEFAULTS,
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  mobile: "9876543210",
  // Mandatory since 2026-08-04.
  alternateContact: "9876500000",
  tenthInstitution: "St Xavier's, Chennai",
  tenthPercentage: 91.4,
  // The board that issued them (2026-08-18). Mandatory for every student.
  tenthBoard: "cbse",
  twelfthInstitution: "St Xavier's, Chennai",
  twelfthPercentage: 88,
  twelfthBoard: "state_board",
  twelfthBoardState: "Tamil Nadu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  programmeLevel: "ug",
  semesters: [
    {
      semesterNumber: 1,
      marks: 8.1,
      currentArrears: 0,
      historyOfArrears: 0,
    },
    {
      semesterNumber: 2,
      marks: 8.24,
      currentArrears: 0,
      historyOfArrears: 0,
    },
  ],
  // Every declared figure needs the document that proves it. Before this the
  // form validated - and submitted - with no evidence whatsoever.
  marksheets: {
    tenth: file("10th.pdf"),
    twelfth: file("12th.pdf"),
    "semester-1": file("sem1.pdf"),
    "semester-2": file("sem2.pdf"),
  },
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
};

const errorsFor = (patch: Partial<SrfFormValues>): Record<string, string> => {
  const result = srfSchema.safeParse({ ...valid, ...patch });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("srfSchema", () => {
  it("accepts a complete, valid form", () => {
    expect(srfSchema.safeParse(valid).success).toBe(true);
  });

  it("requires consent before submission (PRD §4.1)", () => {
    expect(errorsFor({ consent: false as unknown as true }).consent).toMatch(/must consent/i);
  });

  it("requires at least one role category", () => {
    expect(errorsFor({ roleCategories: [], resumeCategories: [] }).roleCategories).toMatch(
      /at least one/i,
    );
  });

  it("requires a resume for every selected role category", () => {
    const errors = errorsFor({
      roleCategories: ["software_technical", "sales"],
      resumeCategories: ["software_technical"],
    });
    expect(errors.resumeCategories).toMatch(/resume for every role category/i);
  });

  // Arrears and CGPA moved onto the semester lines on 2026-08-04. The rules
  // did not go away - they are asserted per-semester in "semester-wise
  // academics" below, and exhaustively in src/domain/academics.test.ts.

  it("accepts cleared backlogs — history above current", () => {
    expect(
      errorsFor({
        semesters: [
          {
            semesterNumber: 1,
            marks: 8,
            currentArrears: 0,
            historyOfArrears: 4,
          },
        ],
        marksheets: {
          tenth: file("10th.pdf"),
          twelfth: file("12th.pdf"),
          "semester-1": file("s.pdf"),
        },
      }),
    ).toEqual({});
  });

  /**
   * The whole point of verification. The SRF marked these uploads required,
   * let the student pick their files, and then discarded them — so the
   * coordinator's queue had nothing to check the declared CGPA against.
   */
  describe("marksheet evidence", () => {
    it("refuses a form with no marksheets at all", () => {
      expect(errorsFor({ marksheets: {} }).marksheets).toMatch(/marksheet/i);
    });

    it("names exactly what is missing", () => {
      const message = errorsFor({
        marksheets: { tenth: file("10th.pdf"), "semester-1": file("s1.pdf") },
      }).marksheets;

      expect(message).toMatch(/12th marksheet/i);
      expect(message).toMatch(/Semester 2 marksheet/i);
      expect(message).not.toMatch(/10th marksheet/i);
    });

    it("requires one for every semester declared, not just one overall", () => {
      expect(
        errorsFor({
          marksheets: {
            tenth: file("10th.pdf"),
            twelfth: file("12th.pdf"),
            "semester-1": file("s1.pdf"),
          },
        }).marksheets,
      ).toMatch(/Semester 2 marksheet/i);
    });

    /** SPEC CHANGE 2026-08-06: offered, not demanded. */
    it("does not demand a postgraduate's consolidated UG marksheet", () => {
      expect(
        errorsFor({
          programmeLevel: "pg",
          ugAggregate: 7.4,
          ugDegree: "B.Sc",
          ugCollege: "Loyola",
          ugBranch: "CS",
        }).marksheets,
      ).toBeUndefined();
    });

    it("rejects anything that is not a file", () => {
      expect(
        Object.keys(
          errorsFor({ marksheets: { tenth: "already-uploaded.pdf" } as unknown as never }),
        ),
      ).toContain("marksheets.tenth");
    });
  });

  it("rejects marks above 100", () => {
    expect(errorsFor({ tenthPercentage: 105 }).tenthPercentage).toMatch(/between 0 and 100/i);
  });

  /**
   * Semester-wise academics, confirmed 2026-08-04. The single cumulative CGPA
   * this form used to collect is gone; the rules live in src/domain/academics.
   */
  describe("semester-wise academics", () => {
    it("accepts an undergraduate with semester lines", () => {
      expect(errorsFor({})).toEqual({});
    });

    it("needs at least one semester", () => {
      expect(errorsFor({ semesters: [] }).semesters).toMatch(/at least one semester/i);
    });

    it("refuses an eleventh undergraduate semester", () => {
      const eleven = Array.from({ length: 11 }, (_, i) => ({
        semesterNumber: i + 1,
        marks: 8,
        currentArrears: 0,
        historyOfArrears: 0,
      }));
      expect(errorsFor({ semesters: eleven }).semesters).toMatch(/at most 10 semesters/i);
    });

    it("refuses a fifth postgraduate semester", () => {
      const five = Array.from({ length: 5 }, (_, i) => ({
        semesterNumber: i + 1,
        marks: 8,
        currentArrears: 0,
        historyOfArrears: 0,
      }));
      expect(
        errorsFor({ programmeLevel: "pg", ugAggregate: 7.4, semesters: five }).semesters,
      ).toMatch(/at most 4 semesters/i);
    });

    it("refuses a CGPA off the 10-point scale, because it is a CGPA not a GPA", () => {
      expect(
        errorsFor({
          semesters: [
            {
              semesterNumber: 1,
              marks: 78,
              currentArrears: 0,
              historyOfArrears: 0,
            },
          ],
        }).semesters,
      ).toMatch(/10-point scale/i);
    });

    it("refuses a history of arrears below the standing count", () => {
      expect(
        errorsFor({
          semesters: [
            {
              semesterNumber: 1,
              marks: 8,
              currentArrears: 3,
              historyOfArrears: 1,
            },
          ],
        }).semesters,
      ).toMatch(/history of arrears/i);
    });

    it("requires a postgraduate to give their completed UG result", () => {
      expect(errorsFor({ programmeLevel: "pg", ugAggregate: null }).ugAggregate).toMatch(
        /undergraduate/i,
      );
    });

    it("does not ask an undergraduate for one", () => {
      expect(errorsFor({ programmeLevel: "ug", ugAggregate: null })).toEqual({});
    });
  });

  it("rejects a malformed mobile number", () => {
    expect(errorsFor({ mobile: "12345" }).mobile).toMatch(/10-digit/i);
  });

  it("allows WhatsApp to be blank", () => {
    expect(errorsFor({ whatsapp: "" })).toEqual({});
  });

  it("rejects a malformed optional number when one is supplied", () => {
    expect(errorsFor({ whatsapp: "123" }).whatsapp).toMatch(/10-digit/i);
  });

  /**
   * Requested 2026-08-04. A drive-day no-show that cannot be reached costs the
   * student the opportunity and the college the recruiter, so a second number
   * is not optional.
   */
  it("requires an alternate contact number", () => {
    expect(errorsFor({ alternateContact: "" }).alternateContact).toMatch(/required|10-digit/i);
  });

  it("still rejects a malformed alternate number", () => {
    expect(errorsFor({ alternateContact: "123" }).alternateContact).toMatch(/10-digit/i);
  });

  it("allows blank professional profile links but rejects malformed ones", () => {
    expect(errorsFor({ github: "" })).toEqual({});
    expect(errorsFor({ github: "not a url" }).github).toMatch(/valid url/i);
  });

  it("rejects an unrealistic passing year", () => {
    expect(errorsFor({ passingYear: 1998 }).passingYear).toMatch(/realistic/i);
  });

  it("reports every problem at once so the student fixes them in one pass", () => {
    const errors = errorsFor({
      mobile: "abc",
      semesters: [
        {
          semesterNumber: 1,
          marks: 99,
          currentArrears: 0,
          historyOfArrears: 0,
        },
      ],
      degree: "",
      roleCategories: [],
      resumeCategories: [],
    });
    // `semesters.0.marks` as well as the group message: a bad figure is now
    // reported ON the field the student has to fix, which is what was asked
    // for on 2026-08-04. The group message still names the rule.
    expect(Object.keys(errors).sort()).toEqual([
      "degree",
      "mobile",
      "roleCategories",
      "semesters",
      "semesters.0.marks",
    ]);
  });

  /**
   * "Some colleges have CGPA and some have % in college marks" (2026-08-06).
   * 78 is a fine percentage and a nonsense CGPA — the old schema could only
   * ever say the latter, so a percentage-scale student could not register.
   */
  describe("marks on either scale", () => {
    // One scale for the whole degree (2026-08-06), not one per semester.
    const semester = (marks: number, collegeMarksScale: "cgpa" | "percentage") => ({
      collegeMarksScale,
      semesters: [{ semesterNumber: 1, marks, currentArrears: 0, historyOfArrears: 0 }],
      marksheets: {
        tenth: file("10th.pdf"),
        twelfth: file("12th.pdf"),
        "semester-1": file("s1.pdf"),
      },
    });

    it("accepts a percentage a CGPA scale would have refused", () => {
      expect(errorsFor(semester(78, "percentage"))).toEqual({});
    });

    it("still refuses an impossible percentage", () => {
      expect(errorsFor(semester(105, "percentage"))["semesters.0.marks"]).toMatch(/0 and 100/i);
    });

    it("still holds a CGPA to ten", () => {
      expect(errorsFor(semester(78, "cgpa"))["semesters.0.marks"]).toMatch(/10-point/i);
    });
  });

  /**
   * Diploma: optional to declare, all-or-nothing once begun (2026-08-06).
   */
  describe("diploma", () => {
    it("accepts a student who did not do one", () => {
      expect(errorsFor({ diplomaMarks: null, diplomaInstitution: "" })).toEqual({});
    });

    it("asks for the college once a figure is entered", () => {
      expect(
        errorsFor({ diplomaMarks: 78, diplomaMarksScale: "percentage" }).diplomaInstitution,
      ).toMatch(/college/i);
    });

    /** SPEC CHANGE 2026-08-06: the diploma marksheet is offered, not demanded. */
    it("does not demand the marksheet once a figure is entered", () => {
      expect(
        errorsFor({
          diplomaMarks: 78,
          diplomaMarksScale: "percentage",
          diplomaInstitution: "Government Polytechnic",
        }).marksheets,
      ).toBeUndefined();
    });
  });

  /**
   * A postgraduate's finished degree. The form used to ask for its CGPA alone,
   * which told a recruiter nothing about where it was earned or in what.
   */
  describe("a postgraduate's completed UG degree", () => {
    const pg = {
      programmeLevel: "pg" as const,
      ugAggregate: 7.4,
      marksheets: {
        tenth: file("10th.pdf"),
        twelfth: file("12th.pdf"),
        ug_consolidated: file("ug.pdf"),
        "semester-1": file("s1.pdf"),
        "semester-2": file("s2.pdf"),
      },
    };

    it("asks where the degree was earned and in what", () => {
      const errors = errorsFor(pg);

      expect(errors.ugDegree).toMatch(/degree/i);
      expect(errors.ugCollege).toMatch(/college/i);
      expect(errors.ugBranch).toMatch(/branch/i);
    });

    it("accepts a complete one", () => {
      expect(
        errorsFor({
          ...pg,
          ugDegree: "B.Sc Computer Science",
          ugCollege: "Loyola College",
          ugBranch: "Computer Science",
        }),
      ).toEqual({});
    });

    it("asks none of it of an undergraduate", () => {
      expect(errorsFor({ programmeLevel: "ug", ugAggregate: null })).toEqual({});
    });
  });
});

/**
 * F17 (UAT 2026-08-06): "The student registration form should also contain an
 * upload button for students to upload the certificates. Name of certificate +
 * upload certificate."
 *
 * F9: "students can upload certificates multiple times, which should be
 * restricted to a single upload."
 *
 * The rules are the domain's (`@domain/certificates`); Zod owns only the shape.
 */
describe("srfSchema — certificates", () => {
  const certificate = (name: string) => ({
    name,
    file: new File(["cert"], `${name}.pdf`, { type: "application/pdf" }),
  });

  it("accepts a named certificate with its file", () => {
    const result = srfSchema.safeParse({
      ...valid,
      certificates: [certificate("AWS Cloud Practitioner")],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a form with no certificates — they are not compulsory", () => {
    expect(srfSchema.safeParse({ ...valid, certificates: [] }).success).toBe(true);
  });

  it("refuses a certificate with no name", () => {
    const result = srfSchema.safeParse({
      ...valid,
      certificates: [{ name: "  ", file: new File(["c"], "c.pdf") }],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a name with no file behind it", () => {
    const result = srfSchema.safeParse({ ...valid, certificates: [{ name: "AWS", file: null }] });

    expect(result.success).toBe(false);
  });

  /** F9: the duplicate is the bug that was reported. */
  it("refuses the same certificate twice", () => {
    const result = srfSchema.safeParse({
      ...valid,
      certificates: [certificate("AWS Cloud Practitioner"), certificate("aws cloud practitioner")],
    });

    expect(result.success).toBe(false);
  });

  it("drops a row the student added and never filled in", () => {
    const result = srfSchema.safeParse({
      ...valid,
      certificates: [certificate("AWS"), { name: "", file: null }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.certificates).toHaveLength(1);
  });
});

/**
 * The board a school figure came from (2026-08-18).
 *
 * The rules are `@domain/boards`'s, restated nowhere: the schema asks the
 * domain, and `0048` asks the same question in SQL, so a pair the form accepts
 * is a pair the database accepts.
 */
describe("school boards", () => {
  it("requires the 10th board", () => {
    expect(errorsFor({ tenthBoard: "" }).tenthBoard).toMatch(/select the board/i);
  });

  it("requires the 12th board", () => {
    expect(errorsFor({ twelfthBoard: "" }).twelfthBoard).toMatch(/select the board/i);
  });

  it("requires the state behind a State Board - it names 36 boards otherwise", () => {
    expect(errorsFor({ tenthBoard: "state_board", tenthBoardState: "" }).tenthBoardState).toMatch(
      /which state/i,
    );
  });

  it("accepts a State Board with its state named", () => {
    expect(
      srfSchema.safeParse({
        ...valid,
        tenthBoard: "state_board",
        tenthBoardState: "Kerala",
      }).success,
    ).toBe(true);
  });

  it("refuses a state that is not a real one", () => {
    expect(
      errorsFor({ tenthBoard: "state_board", tenthBoardState: "Tamilnadu" }).tenthBoardState,
    ).toMatch(/which state/i);
  });

  it("requires Other to be named", () => {
    expect(errorsFor({ twelfthBoard: "other", twelfthBoardState: "" }).twelfthBoardOther).toMatch(
      /name the board/i,
    );
  });

  it("refuses a state against a board that does not have one", () => {
    expect(errorsFor({ tenthBoard: "cbse", tenthBoardState: "Kerala" }).tenthBoardState).toMatch(
      /only select a state/i,
    );
  });

  it("refuses a typed board name against a board that is not Other", () => {
    expect(errorsFor({ tenthBoard: "cbse", tenthBoardOther: "CBSE" }).tenthBoardOther).toMatch(
      /only name the board/i,
    );
  });

  it("refuses a board that is not in the vocabulary at all", () => {
    expect(errorsFor({ tenthBoard: "ICSE" as never }).tenthBoard).toMatch(/select the board/i);
  });
});

/**
 * Who awarded the diploma (2026-08-18, answer 4/5). Optional in full, but
 * all-or-nothing once a figure is declared - the same rule the diploma college
 * already follows, because a mark nobody can attribute is a mark nobody can
 * verify.
 */
describe("diploma university or board", () => {
  const withDiploma = {
    diplomaInstitution: "Govt Polytechnic, Coimbatore",
    diplomaUniversity: "DOTE, Tamil Nadu",
    diplomaMarks: 8.2,
    diplomaMarksScale: "cgpa",
    marksheets: { ...valid.marksheets, diploma: file("diploma.pdf") },
  } as const;

  it("accepts a declared diploma that names who awarded it", () => {
    expect(srfSchema.safeParse({ ...valid, ...withDiploma }).success).toBe(true);
  });

  it("requires it once a diploma figure is declared", () => {
    expect(errorsFor({ ...withDiploma, diplomaUniversity: "" }).diplomaUniversity).toMatch(
      /university or board/i,
    );
  });

  it("treats whitespace as unanswered", () => {
    expect(errorsFor({ ...withDiploma, diplomaUniversity: "   " }).diplomaUniversity).toMatch(
      /university or board/i,
    );
  });

  it("does not ask for it when no diploma is declared", () => {
    expect(srfSchema.safeParse(valid).success).toBe(true);
    expect(errorsFor({ diplomaUniversity: "" }).diplomaUniversity).toBeUndefined();
  });
});
