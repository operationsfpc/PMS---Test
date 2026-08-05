import { validateSemesters } from "@domain/academics";
import { usableCertificates, validateCertificates } from "@domain/certificates";
import { isValidForScale, MARKS_SCALES, normaliseToCgpa } from "@domain/marks";
import { missingMarksheets } from "@domain/marksheets";
import { validateProfileLinks } from "@domain/profile-links";
import {
  isValidIndianMobile,
  isValidPassingYear,
  isValidPercentage,
  missingResumesFor,
} from "@domain/srf-rules";
import { ROLE_CATEGORIES } from "@domain/types";
import { z } from "zod";

/**
 * Shape and format validation for the SRF.
 *
 * Business rules are NOT restated here — every predicate delegates to
 * `@domain/srf-rules`. Zod owns structure; the domain owns meaning.
 */

const percentage = z
  .number({ error: "Enter a number" })
  .refine(isValidPercentage, "Must be between 0 and 100");

const optionalMobile = z
  .string()
  .refine((v) => v === "" || isValidIndianMobile(v), "Enter a valid 10-digit mobile number");

export const srfSchema = z
  .object({
    // Personal
    fullName: z.string().min(2, "Enter your full name").max(100),
    rollNumber: z.string().min(1),
    email: z.email("Enter a valid email address"),
    mobile: z.string().refine(isValidIndianMobile, "Enter a valid 10-digit mobile number"),
    whatsapp: optionalMobile,
    // Mandatory (requested 2026-08-04): a student who cannot be reached on
    // drive day loses the opportunity, and the college loses the recruiter.
    alternateContact: z
      .string()
      .min(1, "An alternate contact number is required.")
      .refine(isValidIndianMobile, "Enter a valid 10-digit mobile number"),

    // ------------------------------------------------------------- school
    // The institution comes BEFORE the marks it issued (2026-08-06): a figure
    // with no school against it cannot be checked by anyone.
    tenthInstitution: z.string().min(1, "Enter the school you did your 10th at").max(160),
    tenthPercentage: percentage,
    twelfthInstitution: z.string().min(1, "Enter the school you did your 12th at").max(160),
    twelfthPercentage: percentage,

    // ------------------------------------------------------------ diploma
    // Optional in full - many students have none - but all-or-nothing: a
    // figure with no college and no marksheet is a mark nobody can verify.
    diplomaInstitution: z.string().max(160),
    diplomaMarks: z.number().nullable().default(null),
    diplomaMarksScale: z.enum(MARKS_SCALES).default("cgpa"),

    // --------------------------------------------- the programme they are on
    degree: z.string().min(1, "Select your degree"),
    branch: z.string().min(1, "Select your branch"),
    passingYear: z
      .number({ error: "Enter your passing year" })
      .refine((y) => isValidPassingYear(y, new Date()), "Enter a realistic passing year"),
    // Semester-wise since 2026-08-04. The single cumulative CGPA is gone:
    // eligibility reads the latest VERIFIED semester (src/domain/academics.ts).
    programmeLevel: z.enum(["ug", "pg"], { error: "Say whether you are pursuing UG or PG" }),

    /**
     * Postgraduates only: the degree they have already finished. The form used
     * to ask for an aggregate CGPA alone, which told a recruiter nothing about
     * where it was earned or in what.
     */
    ugDegree: z.string().max(120),
    ugCollege: z.string().max(160),
    ugBranch: z.string().max(120),
    ugAggregate: z.number().nullable().default(null),
    ugAggregateScale: z.enum(MARKS_SCALES).default("cgpa"),

    /**
     * ONE scale for the whole degree, chosen right after the UG/PG question.
     *
     * 2026-08-06: "just one selection for all field to enter CGPA/Percentage.
     * The metric will not change semester to semester. It will be the same
     * throughout the UG/PG." A college reports one way or the other; asking
     * per semester invited eight chances to answer inconsistently and left
     * eligibility comparing figures that were never on the same scale.
     */
    collegeMarksScale: z.enum(MARKS_SCALES).default("cgpa"),

    semesters: z
      .array(
        z.object({
          semesterNumber: z.number().int(),
          marks: z.number({ error: "Enter the marks for this semester" }),
          currentArrears: z.number().int("Whole numbers only"),
          historyOfArrears: z.number().int("Whole numbers only"),
        }),
      )
      .min(1, "Add at least one semester"),

    /**
     * The marksheets that evidence every figure above, keyed by
     * `src/domain/marksheets.ts` (`tenth`, `twelfth`, `semester-3`, …).
     *
     * These uploads were REQUIRED on screen and then thrown away: the files
     * never left the browser, so a coordinator verified a declared CGPA
     * against nothing. Carrying them in the submission is what makes
     * verification mean anything.
     */
    marksheets: z.record(z.string(), z.instanceof(File, { error: "Choose a file to upload" })),

    // Preferences
    roleCategories: z.array(z.enum(ROLE_CATEGORIES)).min(1, "Select at least one role category"),
    resumeCategories: z.array(z.enum(ROLE_CATEGORIES)),

    // Profiles
    /**
     * Anything beyond the four named below (2026-08-06). The VALUE is not
     * validated as a URL: the request was "the url/user name", and a
     * Codeforces handle is not a URL. Demanding one would refuse exactly the
     * entries this exists to capture.
     */
    otherProfiles: z
      .array(z.object({ label: z.string().max(60), value: z.string().max(300) }))
      .default([]),

    linkedin: z.union([z.literal(""), z.url("Enter a valid URL")]),
    github: z.union([z.literal(""), z.url("Enter a valid URL")]),
    leetcode: z.union([z.literal(""), z.url("Enter a valid URL")]),
    hackerrank: z.union([z.literal(""), z.url("Enter a valid URL")]),

    // Additional
    technicalSkills: z.string(),
    areasOfInterest: z.string(),
    areasOfExpertise: z.string(),
    projects: z.string(),
    /**
     * A certificate is a NAME and a FILE (F17, UAT 2026-08-06). Rows the
     * student added and left blank are dropped rather than refused - the form
     * offers an empty row to type into, and an untouched one is not a mistake.
     *
     * `certifications` (free text) is gone: nothing in it could be verified,
     * and nothing in it was unique, which is what F9 was reported about.
     */
    certificates: z
      .array(
        z.object({
          name: z.string().max(160),
          file: z.instanceof(File).nullable().default(null),
        }),
      )
      .default([])
      .transform((rows) =>
        rows
          .map((row) => ({ ...row, name: row.name.trim() }))
          .filter((row) => row.name !== "" || row.file !== null),
      ),
    achievements: z.string(),

    consent: z.literal(true, { error: "You must consent before submitting" }),
  })
  /**
   * The semester rules are the domain's, not the form's. Every problem is
   * reported at once and joined onto one field: a student fixing one line at a
   * time, resubmitting between each, gives up.
   */
  .superRefine((d, ctx) => {
    // Each figure is judged on the scale it was declared on: 78 is a fine
    // percentage and a nonsense CGPA, and the old schema could only say the
    // latter.
    d.semesters.forEach((s, index) => {
      if (!isValidForScale(s.marks, d.collegeMarksScale)) {
        ctx.addIssue({
          code: "custom",
          path: ["semesters", index, "marks"],
          message:
            d.collegeMarksScale === "percentage"
              ? "A percentage is between 0 and 100."
              : "A CGPA is on the 10-point scale.",
        });
      }
    });

    // The domain rules run on the NORMALISED figure, so one set of rules
    // covers both scales and eligibility can never see a percentage.
    const problems = validateSemesters(
      d.programmeLevel,
      d.semesters.map((s) => ({
        ...s,
        cgpa: normaliseToCgpa(s.marks, d.collegeMarksScale),
        verified: false,
      })),
    );

    if (problems.length > 0) {
      ctx.addIssue({ code: "custom", path: ["semesters"], message: problems.join(" ") });
    }

    // One certificate, one upload - and both halves present. The rule is the
    // domain's, so the form and the database refuse for the same reason.
    const certificateProblems = validateCertificates(
      usableCertificates(d.certificates.map((c) => ({ name: c.name, hasFile: c.file !== null }))),
    );

    if (certificateProblems.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["certificates"],
        message: certificateProblems.join(" "),
      });
    }

    // Named profiles are the student's own words, so the rules are the
    // domain's: an entry needs both halves, names cannot repeat, and a row
    // left blank is dropped rather than held against them.
    const profileProblems = validateProfileLinks(d.otherProfiles);

    if (profileProblems.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["otherProfiles"],
        message: profileProblems.join(" "),
      });
    }

    // Optional to declare, all-or-nothing once begun. The marksheet itself is
    // required by the evidence rule below, which sees the figure.
    if (d.diplomaMarks !== null) {
      if (!isValidForScale(d.diplomaMarks, d.diplomaMarksScale)) {
        ctx.addIssue({
          code: "custom",
          path: ["diplomaMarks"],
          message:
            d.diplomaMarksScale === "percentage"
              ? "A percentage is between 0 and 100."
              : "A CGPA is on the 10-point scale.",
        });
      }
      if (d.diplomaInstitution.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["diplomaInstitution"],
          message: "Enter the college that issued your diploma.",
        });
      }
    }

    // Which documents are required is derived from what the student declared,
    // so adding a semester adds its marksheet. The message names each missing
    // one: "uploads are required" against six file inputs helps nobody.
    const missing = missingMarksheets(
      { ...d, hasDiplomaMarks: d.diplomaMarks !== null },
      Object.keys(d.marksheets),
    );

    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["marksheets"],
        message: `Upload your ${missing.map((s) => s.label).join(", ")}.`,
      });
    }

    // A postgraduate has a completed degree behind them; a recruiter filtering
    // on UG performance has nothing to read without it.
    if (d.programmeLevel === "pg") {
      if (d.ugAggregate === null) {
        ctx.addIssue({
          code: "custom",
          path: ["ugAggregate"],
          message: "Enter your undergraduate result.",
        });
      } else if (!isValidForScale(d.ugAggregate, d.ugAggregateScale)) {
        ctx.addIssue({
          code: "custom",
          path: ["ugAggregate"],
          message:
            d.ugAggregateScale === "percentage"
              ? "A percentage is between 0 and 100."
              : "A CGPA is on the 10-point scale.",
        });
      }

      for (const [field, label] of [
        ["ugDegree", "degree"],
        ["ugCollege", "college"],
        ["ugBranch", "branch"],
      ] as const) {
        if ((d[field] as string).trim() === "") {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `Enter your undergraduate ${label}.`,
          });
        }
      }
    }
  })
  .refine((d) => missingResumesFor(d.roleCategories, d.resumeCategories).length === 0, {
    path: ["resumeCategories"],
    message: "Upload a resume for every role category you selected",
  });

export type SrfFormValues = z.input<typeof srfSchema>;
export type SrfSubmission = z.output<typeof srfSchema>;

/**
 * Blank, not somebody else's details.
 *
 * These used to be a fabricated student ('Priya Ramesh', '21CSE1042'), which
 * is what was reported as the form showing random data. Identity comes from
 * the roster, so the correct default is empty until it is prefilled.
 */
export const SRF_DEFAULTS: SrfFormValues = {
  fullName: "",
  rollNumber: "",
  email: "",
  mobile: "",
  whatsapp: "",
  alternateContact: "",
  tenthInstitution: "",
  tenthPercentage: Number.NaN,
  twelfthInstitution: "",
  twelfthPercentage: Number.NaN,
  diplomaInstitution: "",
  diplomaMarks: null,
  diplomaMarksScale: "cgpa",
  degree: "",
  branch: "",
  passingYear: Number.NaN,
  programmeLevel: "ug",
  ugDegree: "",
  ugCollege: "",
  ugBranch: "",
  ugAggregate: null,
  ugAggregateScale: "cgpa",
  collegeMarksScale: "cgpa",
  semesters: [
    {
      semesterNumber: 1,
      marks: Number.NaN,
      currentArrears: 0,
      historyOfArrears: 0,
    },
  ],
  marksheets: {},
  roleCategories: [],
  resumeCategories: [],
  otherProfiles: [],
  linkedin: "",
  github: "",
  leetcode: "",
  hackerrank: "",
  technicalSkills: "",
  areasOfInterest: "",
  areasOfExpertise: "",
  projects: "",
  certificates: [],
  achievements: "",
  consent: false as unknown as true,
};
