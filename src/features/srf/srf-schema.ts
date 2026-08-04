import { validateSemesters } from "@domain/academics";
import { missingMarksheets } from "@domain/marksheets";
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

    // Academic
    tenthPercentage: percentage,
    twelfthPercentage: percentage,
    degree: z.string().min(1, "Select your degree"),
    branch: z.string().min(1, "Select your branch"),
    passingYear: z
      .number({ error: "Enter your passing year" })
      .refine((y) => isValidPassingYear(y, new Date()), "Enter a realistic passing year"),
    // Semester-wise since 2026-08-04. The single cumulative CGPA is gone:
    // eligibility reads the latest VERIFIED semester (src/domain/academics.ts).
    programmeLevel: z.enum(["ug", "pg"], { error: "Say whether you are pursuing UG or PG" }),
    /** Postgraduates only: the one aggregate standing in for a whole degree. */
    ugAggregateCgpa: z.number().nullable().default(null),
    semesters: z
      .array(
        z.object({
          semesterNumber: z.number().int(),
          cgpa: z.number({ error: "Enter the CGPA for this semester" }),
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
    linkedin: z.union([z.literal(""), z.url("Enter a valid URL")]),
    github: z.union([z.literal(""), z.url("Enter a valid URL")]),
    leetcode: z.union([z.literal(""), z.url("Enter a valid URL")]),
    hackerrank: z.union([z.literal(""), z.url("Enter a valid URL")]),

    // Additional
    technicalSkills: z.string(),
    areasOfInterest: z.string(),
    areasOfExpertise: z.string(),
    projects: z.string(),
    certifications: z.string(),
    achievements: z.string(),

    consent: z.literal(true, { error: "You must consent before submitting" }),
  })
  /**
   * The semester rules are the domain's, not the form's. Every problem is
   * reported at once and joined onto one field: a student fixing one line at a
   * time, resubmitting between each, gives up.
   */
  .superRefine((d, ctx) => {
    const problems = validateSemesters(
      d.programmeLevel,
      d.semesters.map((s) => ({ ...s, verified: false })),
    );

    if (problems.length > 0) {
      ctx.addIssue({ code: "custom", path: ["semesters"], message: problems.join(" ") });
    }

    // Which documents are required is derived from what the student declared,
    // so adding a semester adds its marksheet. The message names each missing
    // one: "uploads are required" against six file inputs helps nobody.
    const missing = missingMarksheets(d, Object.keys(d.marksheets));

    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["marksheets"],
        message: `Upload your ${missing.map((s) => s.label).join(", ")}.`,
      });
    }

    // A postgraduate has a completed degree behind them; a recruiter filtering
    // on UG performance has nothing to read without it.
    if (d.programmeLevel === "pg" && d.ugAggregateCgpa === null) {
      ctx.addIssue({
        code: "custom",
        path: ["ugAggregateCgpa"],
        message: "Enter your undergraduate CGPA.",
      });
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
  tenthPercentage: Number.NaN,
  twelfthPercentage: Number.NaN,
  degree: "",
  branch: "",
  passingYear: Number.NaN,
  programmeLevel: "ug",
  ugAggregateCgpa: null,
  semesters: [{ semesterNumber: 1, cgpa: Number.NaN, currentArrears: 0, historyOfArrears: 0 }],
  marksheets: {},
  roleCategories: [],
  resumeCategories: [],
  linkedin: "",
  github: "",
  leetcode: "",
  hackerrank: "",
  technicalSkills: "",
  areasOfInterest: "",
  areasOfExpertise: "",
  projects: "",
  certifications: "",
  achievements: "",
  consent: false as unknown as true,
};
