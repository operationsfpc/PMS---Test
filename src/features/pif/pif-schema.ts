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
  minTenthPercentage: null,
  minTwelfthPercentage: null,
  arrearsPolicy: "flexible",
  eligiblePassingYears: [] as number[],
  mandatorySkills: "",
  driveMode: "",
  tentativeDate: "",
  timelineNotes: "",
  driveType: "",
} as const;

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
  minTenthPercentage: nullableNumber,
  minTwelfthPercentage: nullableNumber,
  arrearsPolicy: z.enum(ARREAR_POLICIES).default("flexible"),
  eligiblePassingYears: passingYears.default([]),
  mandatorySkills: optionalText,
  driveMode: z.enum(["", ...DRIVE_MODES]).default(""),
  tentativeDate: optionalText,
  timelineNotes: optionalText,
  driveType: z.enum(["", ...DRIVE_TYPES]).default(""),
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
    jobDescription: requiredText("Job description"),
    workLocations: requiredText("Work location"),
    openings: z.number().int().positive("There must be at least one opening."),
    ctcMinLpa: z.number().positive("Minimum CTC is required."),
    minOverallCgpa: z.number().min(0).max(10, "CGPA is on a 10-point scale.").nullable(),
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
  });

export type PifFormValues = z.input<typeof pifDraftSchema>;
export type PifSubmission = z.output<typeof pifSubmitSchema>;
