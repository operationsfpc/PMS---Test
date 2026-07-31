import type { SupabaseClient } from "@supabase/supabase-js";
import type { Enums } from "../../db/database.types";
import type { SrfSubmission } from "./srf-schema";

/**
 * Persistence for the Student Registration Form.
 *
 * The student's own row already exists — it was pre-loaded from the college
 * roster and claimed at first sign-in. Submitting the SRF therefore UPDATES
 * that row and moves it to `srf_submitted` for coordinator verification; it
 * never inserts a student.
 */

export interface SrfRepository {
  submit(values: SrfSubmission): Promise<{ id: string; status: Enums["srf_status"] }>;
}

export class SrfSubmitError extends Error {}

/** Resolves the signed-in user. Injected so the dependency is explicit and testable. */
export type GetAuthUserId = () => Promise<string | null>;

export const sessionUserId =
  (client: SupabaseClient): GetAuthUserId =>
  async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  };

export function createSupabaseSrfRepository(
  client: SupabaseClient,
  getAuthUserId: GetAuthUserId = sessionUserId(client),
): SrfRepository {
  return {
    async submit(values) {
      const userId = await getAuthUserId();
      if (userId === null) {
        throw new SrfSubmitError("Your session has expired. Please sign in again.");
      }

      const { data, error } = await client
        .from("students")
        .update({
          full_name: values.fullName,
          mobile: values.mobile,
          whatsapp: values.whatsapp === "" ? null : values.whatsapp,
          alternate_contact: values.alternateContact === "" ? null : values.alternateContact,
          tenth_percentage: values.tenthPercentage,
          twelfth_percentage: values.twelfthPercentage,
          passing_year: values.passingYear,
          overall_cgpa: values.overallCgpa,
          current_arrears: values.currentArrears,
          history_of_arrears: values.historyOfArrears,
          technical_skills: values.technicalSkills,
          areas_of_interest: values.areasOfInterest,
          areas_of_expertise: values.areasOfExpertise,
          projects: values.projects,
          certifications: values.certifications,
          achievements: values.achievements,
          linkedin_url: values.linkedin === "" ? null : values.linkedin,
          github_url: values.github === "" ? null : values.github,
          leetcode_url: values.leetcode === "" ? null : values.leetcode,
          hackerrank_url: values.hackerrank === "" ? null : values.hackerrank,
          consent_given_at: new Date().toISOString(),
          srf_status: "srf_submitted" satisfies Enums["srf_status"],
          srf_submitted_at: new Date().toISOString(),
        })
        .eq("auth_user_id", userId)
        .select("id, srf_status")
        .single();

      if (error !== null) {
        throw new SrfSubmitError(translate(error.code, error.message));
      }

      return { id: data.id as string, status: data.srf_status as Enums["srf_status"] };
    },
  };
}

/**
 * Database errors are not student-facing prose. Translate the ones a student
 * can actually cause; keep everything else generic so we never leak internals.
 */
function translate(code: string | undefined, message: string): string {
  if (code === "23514" && /arrears_consistent/.test(message)) {
    return "Your arrear history cannot be lower than your standing arrears.";
  }
  if (code === "23514" && /overall_cgpa/.test(message)) {
    return "CGPA must be on a 10-point scale.";
  }
  if (code === "42501" || /placement coordinator/.test(message)) {
    return "Verified academic data can only be changed by your placement coordinator.";
  }
  if (code === "PGRST116") {
    return "We could not find your student record. Contact your placement coordinator.";
  }
  return "Could not submit your form. Please try again.";
}
