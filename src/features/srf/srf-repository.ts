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
          programme_level: values.programmeLevel,
          ug_aggregate_cgpa: values.ugAggregateCgpa,
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

      const studentId = data.id as string;

      /**
       * Semester lines live in their own table, and are replaced wholesale
       * rather than merged: the form shows the student's whole academic
       * record, so what is on screen must be what ends up stored. Merging
       * would silently keep a line the student deleted.
       *
       * Written AFTER the student row, because the per-level cap trigger reads
       * programme_level from it - inserting first would size a postgraduate's
       * record against the undergraduate limit.
       */
      await client.from("student_semesters").delete().eq("student_id", studentId);

      if (values.semesters.length > 0) {
        const { error: semesterError } = await client.from("student_semesters").insert(
          values.semesters.map((s) => ({
            student_id: studentId,
            semester_number: s.semesterNumber,
            cgpa: s.cgpa,
            current_arrears: s.currentArrears,
            history_of_arrears: s.historyOfArrears,
          })),
        );

        if (semesterError !== null) {
          throw new SrfSubmitError(translate(semesterError.code, semesterError.message));
        }
      }

      return { id: studentId, status: data.srf_status as Enums["srf_status"] };
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
