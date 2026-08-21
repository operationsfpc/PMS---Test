import { jobDescriptionFileProblem } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { JOINING_TIMELINES, joiningNotesFor } from "@domain/joining";
import { isValidForScale, MARKS_SCALES } from "@domain/marks";
import { nightTimingFor, nightTimingIsMissing, SHIFT_TYPES } from "@domain/shift";
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
 * The recruiter's own JD (J1, 2026-08-18).
 *
 * Validated in a DRAFT as well as a submission. A draft may be half-finished,
 * but it may not hold a file the bucket will refuse — the AE would lose the
 * upload and be told "could not save the PIF" about a form that is fine.
 */
const jobDescriptionFile = z
  .custom<File | null>((v) => v === null || v === undefined || v instanceof File, {
    message: "Attach the job description as a file.",
  })
  .transform((v) => (v instanceof File ? v : null))
  .superRefine((file, ctx) => {
    const problem = jobDescriptionFileProblem(file);
    if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
  })
  .default(null);

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

/** A4 (UAT 2026-08-19): one of the drive's contacts. Every field optional (Q2). */
export interface PifContact {
  readonly name: string;
  readonly designation: string;
  readonly email: string;
  readonly phone: string;
}

export const PIF_DEFAULTS = {
  companyName: "",
  industry: "",
  companyWebsite: "",
  contacts: [] as PifContact[],
  roleTitle: "",
  roleCategory: "",
  jobDescription: "",
  openings: null,
  workLocations: "",
  ctcMinLpa: null,
  ctcMaxLpa: null,
  ctcBreakup: "",
  stipendMinMonthly: null,
  stipendMaxMonthly: null,
  shiftType: "",
  shiftNightTiming: "",
  bondDetails: "",
  jobDescriptionFile: null as File | null,
  minOverallCgpa: null,
  minOverallCgpaScale: "cgpa",
  minTenthPercentage: null,
  minTwelfthPercentage: null,
  arrearsPolicy: "flexible",
  eligiblePassingYears: [] as number[],
  mandatorySkills: "",
  driveMode: "",
  // UAT 2026-08-21 item 2: the off-campus venue. Absence is a legitimate
  // answer at PIF time — the Central CPC records it later once confirmed.
  venueStatus: "not_yet_confirmed",
  venue: "",
  tentativeDate: "",
  timelineNotes: "",
  joiningTimeline: "",
  joiningImmediateNotes: "",
  joiningLaterNotes: "",
  driveType: "",
  additionalDesignations: [] as string[],
  // Typed, not inferred as `readonly []`: RHF needs a mutable array shape.
  rounds: [] as Array<{ sequence: number; name: string }>,
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

/**
 * A4 (UAT 2026-08-19): the contacts, several per drive. A row the AE added
 * and left entirely blank is dropped, not refused — the same courtesy the
 * designation rows extend. An email, when given, must be one.
 */
const contacts = z
  .array(
    z.object({
      name: optionalText,
      designation: optionalText,
      email: z
        .string()
        .trim()
        .default("")
        .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
          message: "Enter a valid contact email.",
        }),
      phone: optionalText,
    }),
  )
  // A blank row is the "+" pressed and abandoned — dropped, never refused.
  .transform((rows) =>
    rows.filter((row) =>
      [row.name, row.designation, row.email, row.phone].some((field) => field.trim() !== ""),
    ),
  );

/** A draft needs only enough to identify what it is about. */
export const pifDraftSchema = z.object({
  companyName: requiredText("Company name"),
  industry: optionalText,
  companyWebsite: optionalUrl,
  contacts: contacts.default([]),
  roleTitle: optionalText,
  roleCategory: z.enum(["", ...ROLE_CATEGORIES]).default(""),
  jobDescription: optionalText,
  openings: nullableNumber,
  workLocations: optionalText,
  ctcMinLpa: nullableNumber,
  ctcMaxLpa: nullableNumber,
  ctcBreakup: optionalText,
  /**
   * A2 (UAT 2026-08-19): an internship pays a monthly stipend, not a CTC.
   * ₹ per month, whole rupees. Which of stipend/CTC a SUBMISSION must carry
   * is decided by the drive type, below.
   */
  stipendMinMonthly: nullableNumber,
  stipendMaxMonthly: nullableNumber,
  /**
   * J2: a radio, not a text box. `""` is "not answered" — the form preselects
   * nothing, because a preselected Day is an answer nobody gave.
   */
  shiftType: z.enum(["", ...SHIFT_TYPES]).default(""),
  /** Night only. `@domain/shift` and `0051` both refuse it anywhere else. */
  shiftNightTiming: optionalText,
  bondDetails: optionalText,
  jobDescriptionFile,
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
  /**
   * UAT 2026-08-21 item 2: where an off-campus (physical-outside or pooled)
   * drive happens. "Not yet confirmed" must never block a submit — the venue
   * often is not final when the AE files the PIF; the Central CPC follows up
   * (answer Q5). Judged in `pifSubmitSchema` only when the mode has a venue
   * at all (`@domain/drive-venue`).
   */
  venueStatus: z.enum(["not_yet_confirmed", "confirmed"]).default("not_yet_confirmed"),
  venue: optionalText,
  tentativeDate: optionalText,
  /**
   * The prose box J3 replaces. Kept in the contract because four live drives
   * hold their whole joining story in it and answer 9 leaves them untouched;
   * the form no longer collects it.
   */
  timelineNotes: optionalText,
  /** J3: the choice, and one comment box per option (answer 6). */
  joiningTimeline: z.enum(["", ...JOINING_TIMELINES]).default(""),
  joiningImmediateNotes: optionalText,
  joiningLaterNotes: optionalText,
  driveType: z.enum(["", ...DRIVE_TYPES]).default(""),
  additionalDesignations: additionalDesignations.default([]),
  /**
   * The rounds the recruiter runs, NAMED and in order (2026-08-18):
   * "AE name them on the PIF with Round Number - Round 1 - Aptitude Test;
   * Round 2 - Interview". They are the logical rounds a student progresses
   * through, so they are carried onto the drive at publish rather than being
   * invented a second time by the Central CPC.
   *
   * F11's bare count is derived from this now - a count and a list cannot
   * disagree if there is only a list.
   */
  rounds: z
    .array(z.object({ sequence: z.number().int().positive(), name: z.string() }))
    .default([]),
});

/**
 * Submission is the handover to the Delivery Head, so everything the approver
 * needs to judge the drive must be present.
 */
export const pifSubmitSchema = pifDraftSchema
  .extend({
    companyName: requiredText("Company name"),
    roleTitle: requiredText("Role title"),
    /**
     * A1 (UAT 2026-08-19): the drive type is the FIRST question on the form
     * and everything else — which compensation exists, which students see it,
     * how the offer classifies — hangs off it. A submission must answer it.
     */
    driveType: z.enum(DRIVE_TYPES, { message: "Choose the drive type." }),
    roleCategory: z.enum(ROLE_CATEGORIES, { message: "Choose a role category." }),
    rounds: z
      .array(z.object({ sequence: z.number().int().positive(), name: z.string() }))
      .min(1, "A selection process has at least one round.")
      .refine(
        (rounds) => rounds.every((round) => round.name.trim() !== ""),
        "Name every round — a student cannot prepare for “Round 2”.",
      ),
    /**
     * NOT required since 2026-08-18 (answer 2: "keep space to type JD. Field
     * is not mandatory"). The recruiter's PDF can carry it now, and retyping
     * an attachment to get past a validator is how a summary that nobody
     * checked ends up on a student's drive card.
     */
    jobDescription: optionalText,
    /** J3: the choice is required; its comment is not (answer 7). */
    joiningTimeline: z.enum(JOINING_TIMELINES, {
      message: "Say whether joining is immediate or later.",
    }),
    workLocations: requiredText("Work location"),
    openings: z.number().int().positive("There must be at least one opening."),
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
  /**
   * A2: the compensation the drive type calls for. A placement or convertible
   * carries a CTC; an internship or convertible carries a stipend. Checked
   * here rather than as required fields, because which are required depends
   * on the type.
   */
  .superRefine((v, ctx) => {
    const wantsCtc = v.driveType === "placement" || v.driveType === "internship_convertible";
    const wantsStipend = v.driveType === "internship" || v.driveType === "internship_convertible";

    if (wantsCtc && (v.ctcMinLpa === null || v.ctcMinLpa <= 0)) {
      ctx.addIssue({ code: "custom", path: ["ctcMinLpa"], message: "Minimum CTC is required." });
    }
    if (wantsCtc && v.ctcMinLpa !== null && v.ctcMaxLpa !== null && v.ctcMaxLpa < v.ctcMinLpa) {
      ctx.addIssue({
        code: "custom",
        path: ["ctcMaxLpa"],
        message: "Maximum CTC cannot be below the minimum.",
      });
    }
    if (wantsStipend && (v.stipendMinMonthly === null || v.stipendMinMonthly <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["stipendMinMonthly"],
        message: "The monthly stipend is required for an internship.",
      });
    }
    if (
      wantsStipend &&
      v.stipendMinMonthly !== null &&
      v.stipendMaxMonthly !== null &&
      v.stipendMaxMonthly < v.stipendMinMonthly
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["stipendMaxMonthly"],
        message: "Maximum stipend cannot be below the minimum.",
      });
    }
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
  )
  /**
   * J2: "night shift" with no hours is not something a student can plan
   * around, and it is the only reason the timing box exists.
   */
  .refine((v) => !nightTimingIsMissing(v.shiftType, v.shiftNightTiming), {
    path: ["shiftNightTiming"],
    message: "Give the hours of the night shift — a student plans their travel around them.",
  })
  /**
   * UAT 2026-08-21 item 2: "Venue confirmed" with nothing typed is not a
   * venue. "Not yet confirmed" always submits — blocking the AE on a fact
   * the company has not given them is the bug this field exists to fix.
   */
  .refine(
    (v) =>
      !driveVenueApplies(v.driveMode) || v.venueStatus !== "confirmed" || v.venue.trim() !== "",
    {
      path: ["venue"],
      message: "Type the venue, or choose “Venue not yet confirmed”.",
    },
  )
  /**
   * Anything the AE typed and then abandoned by changing a radio is dropped
   * HERE, not merely hidden by the form. A hidden field still submits, and
   * `0051` refuses a night timing on a day shift outright.
   */
  .transform((v) => {
    const notes = joiningNotesFor(v.joiningTimeline, v.joiningImmediateNotes, v.joiningLaterNotes);
    // A2: compensation the chosen type does not have is DROPPED, not stored —
    // a stipend on a placement drive is an answer nobody gave (the J2/J3 rule).
    const wantsCtc = v.driveType === "placement" || v.driveType === "internship_convertible";
    const wantsStipend = v.driveType === "internship" || v.driveType === "internship_convertible";

    return {
      ...v,
      shiftNightTiming: nightTimingFor(v.shiftType, v.shiftNightTiming),
      joiningImmediateNotes: notes.immediate,
      joiningLaterNotes: notes.later,
      ctcMinLpa: wantsCtc ? v.ctcMinLpa : null,
      ctcMaxLpa: wantsCtc ? v.ctcMaxLpa : null,
      ctcBreakup: wantsCtc ? v.ctcBreakup : "",
      stipendMinMonthly: wantsStipend ? v.stipendMinMonthly : null,
      stipendMaxMonthly: wantsStipend ? v.stipendMaxMonthly : null,
    };
  });

export type PifFormValues = z.input<typeof pifDraftSchema>;
export type PifSubmission = z.output<typeof pifSubmitSchema>;
