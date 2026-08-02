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

    min_overall_cgpa: values.minOverallCgpa ?? null,
    min_tenth_percentage: values.minTenthPercentage ?? null,
    min_twelfth_percentage: values.minTwelfthPercentage ?? null,
    arrears_policy: values.arrearsPolicy,
    eligible_passing_years: values.eligiblePassingYears ?? [],
    mandatory_skills: nullIfBlank(values.mandatorySkills),

    drive_mode: nullIfBlank(values.driveMode),
    tentative_date: nullIfBlank(values.tentativeDate),
    timeline_notes: nullIfBlank(values.timelineNotes),
    drive_type: nullIfBlank(values.driveType),

    status,
    created_by: actorId,
  };
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
      throw new PifError(
        error.code === "42501"
          ? "You do not have permission to raise a PIF."
          : "Could not save the PIF. Please try again.",
      );
    }

    return { id: data.id as string, status: data.status as string };
  }

  return {
    saveDraft: (values) => write(values, "draft"),
    submit: (values) => write(values, "submitted"),
  };
}
