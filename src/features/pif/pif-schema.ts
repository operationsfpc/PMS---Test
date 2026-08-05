import { isValidForScale, MARKS_SCALES } from "@domain/marks";
import { ARREAR_POLICIES, DRIVE_MODES, DRIVE_TYPES, ROLE_CATEGORIES } from "@domain/types";
import { z } from "zod";

/**
 * The AE's Position Information Form, Sections 1-4.
 *
 * Two schemas on purpose:
 *   - `pifDraftSchema` lets an AE save a half-finished PIF and come back.
 *   - `pifSubmitSchema` guards the handover to the Delivery Head, who should
 *     never be asked to approve an empty form.
 *
 * `offer_category` is absent by design. §3.3 makes it the Delivery Head's
 * decision, set at approval and immutable afterwards - an AE must not be able
 * to propose it, even accidentally.
 */

const optionalText = z.string().trim().default("");
const requiredText = (label: string) => z.string().trim().min(1, `${label} is required.`);

/** Empty means "not supplied"; anything else must be a real URL. */
const optionalUrl = z
  .string()
  .trim()
  .default("")
  .refine((v) => v === "" || /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), {
    message: "Enter a full URL, including https://",
  });

const nullableNumber = z.number().nullable().default(null);

/**
 * Checkbox groups hand back an array of strings (or a bare string when one box
 * is ticked). Normalising here keeps the DOM's representation out of the rest
 * of the schema and out of the form.
 */
const passingYears = z.preprocess((v) => {
  if (Array.isArray(v)) return v.filter((x) => x !== false && x !== "").map(Number);
  if (v === "" || v === null || v === undefined || v === false) return [];
  return [Number(v)];
}, z.array(z.number().int()));

export const PIF_DEFAULTS = {
  companyName: "",
  industry: "",
  companyWebsite: "",
  spocName: "",
  spocDesignation: "",
  spocEmail: "",
  spocPhone: "",
  roleTitle: "",
  roleCategory: "",
  jobDescription: "",
  openings: null,
  workLocations: "",
  ctcMinLpa: null,
  ctcMaxLpa: null,
  ctcBreakup: "",
  shiftType: "",
  bondDetails: "",
  minOverallCgpa: null,
  minOverallCgpaScale: "cgpa",
  minTenthPercentage: null,
  minTwelfthPercentage: null,
  arrearsPolicy: "flexible",
  eligiblePassingYears: [] as number[],
  mandatorySkills: "",
  driveMode: "",
  tentativeDate: "",
  timelineNotes: "",
  driveType: "",
  additionalDesignations: [] as string[],
  roundCount: null,
} as const;

/**
 * Designations beyond the role title, covered by the SAME interview process.
 *
 * F7 (UAT 2026-08-06). Blank rows are dropped rather than refused: the form
 * adds an empty row for the AE to type into, and an untouched one is not a
 * mistake worth an error message.
 */
const additionalDesignations = z.preprocess(
  (v) =>
    (Array.isArray(v) ? v : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x !== ""),
  z.array(z.string().max(120)),
);

/** A draft needs only enough to identify what it is about. */
export const pifDraftSchema = z.object({
  companyName: requiredText("Company name"),
  industry: optionalText,
  companyWebsite: optionalUrl,
  spocName: optionalText,
  spocDesignation: optionalText,
  spocEmail: optionalText,
  spocPhone: optionalText,
  roleTitle: optionalText,
  roleCategory: z.enum(["", ...ROLE_CATEGORIES]).default(""),
  jobDescription: optionalText,
  openings: nullableNumber,
  workLocations: optionalText,
  ctcMinLpa: nullableNumber,
  ctcMaxLpa: nullableNumber,
  ctcBreakup: optionalText,
  shiftType: optionalText,
  bondDetails: optionalText,
  minOverallCgpa: nullableNumber,
  /**
   * F12: recruiters state the bar the way their own HR does. The DECLARED
   * figure and its scale are both kept; the normalised CGPA every drive is
   * filtered on is derived once, in the repository, via
   * `@domain/marks.normaliseToCgpa`.
   */
  minOverallCgpaScale: z.enum(MARKS_SCALES).default("cgpa"),
  minTenthPercentage: nullableNumber,
  minTwelfthPercentage: nullableNumber,
  arrearsPolicy: z.enum(ARREAR_POLICIES).default("flexible"),
  eligiblePassingYears: passingYears.default([]),
  mandatorySkills: optionalText,
  driveMode: z.enum(["", ...DRIVE_MODES]).default(""),
  tentativeDate: optionalText,
  timelineNotes: optionalText,
  driveType: z.enum(["", ...DRIVE_TYPES]).default(""),
  additionalDesignations: additionalDesignations.default([]),
  /** F11: how many rounds the recruiter runs. Optional in a draft. */
  roundCount: nullableNumber,
});

/**
 * Submission is the handover to the Delivery Head, so everything the approver
 * needs to judge the drive must be present.
 */
export const pifSubmitSchema = pifDraftSchema
  .extend({
    companyName: requiredText("Company name"),
    spocEmail: z.string().trim().email("Enter a valid contact email."),
    roleTitle: requiredText("Role title"),
    roleCategory: z.enum(ROLE_CATEGORIES, { message: "Choose a role category." }),
    roundCount: z
      .number({ message: "Enter the number of rounds in the selection process." })
      .int()
      .positive("A selection process has at least one round."),
    jobDescription: requiredText("Job description"),
    workLocations: requiredText("Work location"),
    openings: z.number().int().positive("There must be at least one opening."),
    ctcMinLpa: z.number().positive("Minimum CTC is required."),
    minOverallCgpa: z.number().min(0).nullable(),
    eligiblePassingYears: z.preprocess(
      (v) => {
        if (Array.isArray(v)) return v.filter((x) => x !== false && x !== "").map(Number);
        if (v === "" || v === null || v === undefined || v === false) return [];
        return [Number(v)];
      },
      z.array(z.number().int()).min(1, "Choose at least one passing year."),
    ),
  })
  .refine((v) => v.ctcMaxLpa === null || v.ctcMaxLpa >= v.ctcMinLpa, {
    path: ["ctcMaxLpa"],
    message: "Maximum CTC cannot be below the minimum.",
  })
  /**
   * The cutoff is judged on the scale it was declared on — 65 is a reasonable
   * percentage and a nonsense CGPA, and one ceiling could only ever say one of
   * those two things.
   */
  .refine(
    (v) => v.minOverallCgpa === null || isValidForScale(v.minOverallCgpa, v.minOverallCgpaScale),
    {
      path: ["minOverallCgpa"],
      message: "A CGPA is on the 10-point scale; a percentage is between 0 and 100.",
    },
  )
  /**
   * A repeated job title is the AE filling the same designation in twice, and
   * it would appear twice on the student's drive card.
   */
  .refine(
    (v) => {
      const all = [
        v.roleTitle.trim().toLowerCase(),
        ...v.additionalDesignations.map((d) => d.toLowerCase()),
      ];
      return new Set(all).size === all.length;
    },
    {
      path: ["additionalDesignations"],
      message: "Each designation may only be named once.",
    },
  );

export type PifFormValues = z.input<typeof pifDraftSchema>;
export type PifSubmission = z.output<typeof pifSubmitSchema>;
