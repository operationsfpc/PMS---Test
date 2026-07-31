import {
  isConsistentArrears,
  isValidCgpa,
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
    alternateContact: optionalMobile,

    // Academic
    tenthPercentage: percentage,
    twelfthPercentage: percentage,
    degree: z.string().min(1, "Select your degree"),
    branch: z.string().min(1, "Select your branch"),
    passingYear: z
      .number({ error: "Enter your passing year" })
      .refine((y) => isValidPassingYear(y, new Date()), "Enter a realistic passing year"),
    overallCgpa: z
      .number({ error: "Enter your CGPA" })
      .refine(isValidCgpa, "CGPA is on a 10-point scale"),
    currentArrears: z.number().int("Whole numbers only").min(0, "Cannot be negative"),
    historyOfArrears: z.number().int("Whole numbers only").min(0, "Cannot be negative"),

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
  .refine((d) => isConsistentArrears(d.currentArrears, d.historyOfArrears), {
    path: ["historyOfArrears"],
    message: "Arrear history cannot be lower than your standing arrears",
  })
  .refine((d) => missingResumesFor(d.roleCategories, d.resumeCategories).length === 0, {
    path: ["resumeCategories"],
    message: "Upload a resume for every role category you selected",
  });

export type SrfFormValues = z.input<typeof srfSchema>;
export type SrfSubmission = z.output<typeof srfSchema>;

export const SRF_DEFAULTS: SrfFormValues = {
  fullName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  email: "priya.r@example.edu",
  mobile: "",
  whatsapp: "",
  alternateContact: "",
  tenthPercentage: Number.NaN,
  twelfthPercentage: Number.NaN,
  degree: "",
  branch: "",
  passingYear: Number.NaN,
  overallCgpa: Number.NaN,
  currentArrears: 0,
  historyOfArrears: 0,
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
