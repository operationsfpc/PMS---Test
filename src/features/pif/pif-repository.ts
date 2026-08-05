import { normaliseToCgpa } from "@domain/marks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PifFormValues } from "./pif-schema";

export class PifError extends Error {}

export interface PifRepository {
  saveDraft(values: PifFormValues): Promise<{ id: string; status: string }>;
  submit(values: PifFormValues): Promise<{ id: string; status: string }>;
}

export type GetActorId = () => Promise<string | null>;

/** Empty strings are the form's way of saying "not supplied"; the database's is NULL. */
const nullIfBlank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/**
 * Maps the AE's form onto the drives table.
 *
 * `offer_category` is never written here, whatever arrives in `values`. §3.3
 * makes it the Delivery Head's decision at approval and immutable afterwards,
 * so the AE's form must not be able to set it even if a field were added by
 * mistake later.
 */
function toRow(values: PifFormValues, actorId: string, status: "draft" | "submitted") {
  return {
    company_name: values.companyName,
    industry: nullIfBlank(values.industry),
    company_website: nullIfBlank(values.companyWebsite),
    spoc_name: nullIfBlank(values.spocName),
    spoc_designation: nullIfBlank(values.spocDesignation),
    spoc_email: nullIfBlank(values.spocEmail),
    spoc_phone: nullIfBlank(values.spocPhone),

    role_title: nullIfBlank(values.roleTitle),
    role_category: nullIfBlank(values.roleCategory),
    job_description: nullIfBlank(values.jobDescription),
    openings: values.openings ?? null,
    work_locations: nullIfBlank(values.workLocations),
    ctc_min_lpa: values.ctcMinLpa ?? null,
    ctc_max_lpa: values.ctcMaxLpa ?? null,
    ctc_breakup: nullIfBlank(values.ctcBreakup),
    shift_type: nullIfBlank(values.shiftType),
    bond_details: nullIfBlank(values.bondDetails),

    // F12: two columns, deliberately. `min_overall_marks` + its scale are what
    // the AE typed and what a coordinator checks against the recruiter's mail;
    // `min_overall_cgpa` is the ONE scale R5 compares students against, so the
    // conversion happens once, here, rather than at every filter.
    min_overall_marks: values.minOverallCgpa ?? null,
    min_overall_cgpa_scale: values.minOverallCgpaScale ?? "cgpa",
    min_overall_cgpa:
      values.minOverallCgpa === null || values.minOverallCgpa === undefined
        ? null
        : normaliseToCgpa(values.minOverallCgpa, values.minOverallCgpaScale ?? "cgpa"),
    min_tenth_percentage: values.minTenthPercentage ?? null,
    min_twelfth_percentage: values.minTwelfthPercentage ?? null,
    arrears_policy: values.arrearsPolicy,
    eligible_passing_years: values.eligiblePassingYears ?? [],
    mandatory_skills: nullIfBlank(values.mandatorySkills),

    drive_mode: nullIfBlank(values.driveMode),
    tentative_date: nullIfBlank(values.tentativeDate),
    timeline_notes: nullIfBlank(values.timelineNotes),
    drive_type: nullIfBlank(values.driveType),

    // F7: one interview process, several job titles, ONE PIF.
    additional_designations: values.additionalDesignations ?? [],
    // F11: read back by the Central CPC's publish screen, which used to ask
    // them to remember the round list.
    round_count: values.roundCount ?? null,

    status,
    created_by: actorId,
  };
}

/**
 * Turns a PostgREST failure into something with a remedy in it.
 *
 * A PIF failed against the live project and the only diagnostic anyone had was
 * "please try again" - which was wrong in every one of these cases. Each of
 * these has a different fix, and the AE or the Admin reading it needs to know
 * which one they are looking at.
 */
function explain(error: { code?: string; message?: string }): string {
  const message = error.message ?? "";

  switch (error.code) {
    case "42501":
      return "You do not have permission to raise a PIF. Ask an Admin to check your role.";
    case "PGRST204":
    case "PGRST205":
      // The app is asking for a column the project does not have: migrations
      // have not been pushed. Nothing the AE does will fix it.
      return `The database is out of date and cannot store this PIF yet (${message}). This needs an Admin, not a retry.`;
    case "23502":
      return `A required field was empty: ${message}`;
    case "23514":
      return `A value broke one of the drive's rules: ${message}`;
    case "23505":
      return "That drive already exists.";
    case "23503":
      return `Something this PIF refers to does not exist: ${message}`;
    default:
      return message === "" ? "Could not save the PIF." : `Could not save the PIF: ${message}`;
  }
}

export function createSupabasePifRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): PifRepository {
  async function write(values: PifFormValues, status: "draft" | "submitted") {
    const actorId = await getActorId();
    if (actorId === null) {
      throw new PifError("Your session has expired. Please sign in again.");
    }

    const { data, error } = await client
      .from("drives")
      .insert(toRow(values, actorId, status))
      .select("id, status")
      .single();

    if (error !== null) {
      // Keep the original as `cause`: the message is for the AE, the cause is
      // for whoever has to work out why it happened.
      throw new PifError(explain(error), { cause: error });
    }

    return { id: data.id as string, status: data.status as string };
  }

  return {
    saveDraft: (values) => write(values, "draft"),
    submit: (values) => write(values, "submitted"),
  };
}
