import {
  type MarksheetKind,
  marksheetSlotKey,
  missingMarksheets,
  requiredMarksheets,
} from "@domain/marksheets";
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
  /**
   * Stores the unsent form. Resolves `false` rather than throwing when it
   * fails - see the implementation for why.
   */
  saveDraft(values: unknown): Promise<boolean>;
}

export class SrfSubmitError extends Error {}

/** Private since 0010. Nothing here is ever served publicly. */
const MARKSHEET_BUCKET = "marksheets";

/**
 * Stores the marksheets and records each one against the student.
 *
 * Returns document ids keyed by marksheet slot, so the caller can point each
 * declared figure at the document that evidences it. This is what was missing
 * entirely: the form collected these files and dropped them on the floor, so
 * `student_semesters.marksheet_id` was never written and the coordinator's
 * queue had nothing to check a declared CGPA against.
 */
async function storeMarksheets(
  client: SupabaseClient,
  studentId: string,
  values: SrfSubmission,
): Promise<ReadonlyMap<string, string>> {
  const slots = requiredMarksheets(values);

  const files = slots.flatMap((slot) => {
    const file = values.marksheets[slot.key];
    return file === undefined ? [] : [{ slot, file }];
  });

  if (files.length === 0) return new Map();

  const rows: Array<{
    student_id: string;
    kind: MarksheetKind;
    storage_path: string;
    size_bytes: number;
  }> = [];

  for (const { slot, file } of files) {
    // Namespaced by student id because that is exactly what the storage policy
    // checks (0022), and stamped so a re-upload never collides with an earlier
    // one - storage_path is unique, and a student correcting a bad scan is
    // normal. The slot key is in the name so a coordinator reading the bucket
    // can tell which figure the file belongs to.
    const path = `${studentId}/${slot.key}-${Date.now()}-${file.name}`;

    const { error } = await client.storage
      .from(MARKSHEET_BUCKET)
      .upload(path, file, { contentType: file.type });

    if (error !== null) {
      throw new SrfSubmitError(
        `Could not upload your ${slot.label}. Check your connection and try again.`,
      );
    }

    rows.push({
      student_id: studentId,
      kind: slot.kind,
      storage_path: path,
      size_bytes: file.size,
    });
  }

  const { data, error } = await client.from("student_documents").insert(rows).select("id");

  if (error !== null || data === null) {
    throw new SrfSubmitError("Could not save your marksheets. Please try again.");
  }

  return new Map(files.map(({ slot }, index) => [slot.key, data[index]?.id as string]));
}

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

      /**
       * Belt and braces with the schema. A repository that trusted its caller
       * would let any other code path drop a form with no evidence into the
       * verification queue, which is the defect this whole change exists to
       * close.
       */
      const missing = missingMarksheets(values, Object.keys(values.marksheets));
      if (missing.length > 0) {
        throw new SrfSubmitError(
          `Upload your ${missing.map((s) => s.label).join(", ")} before submitting.`,
        );
      }

      /**
       * The id is resolved BEFORE anything is written, because the evidence
       * has to reach storage before the form reaches the queue. Submitting
       * first and uploading second would ask a coordinator to verify figures
       * against documents that do not exist.
       */
      const { data: own, error: ownError } = await client
        .from("students")
        .select("id")
        .eq("auth_user_id", userId)
        .single();

      if (ownError !== null || own === null) {
        throw new SrfSubmitError(translate(ownError?.code, ownError?.message ?? ""));
      }

      const studentId = own.id as string;
      const documentIds = await storeMarksheets(client, studentId, values);

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
          // A postgraduate's UG aggregate stands in for an entire degree, so
          // it is evidenced like any other declared mark (A31).
          ug_marksheet_id: documentIds.get("ug_consolidated") ?? null,
          consent_given_at: new Date().toISOString(),
          srf_status: "srf_submitted" satisfies Enums["srf_status"],
          srf_submitted_at: new Date().toISOString(),
          // The draft has served its purpose. Left behind, the next visit
          // would restore a copy of a form already submitted and the student
          // would edit something that no longer means anything.
          srf_draft: null,
          srf_draft_saved_at: null,
        })
        .eq("auth_user_id", userId)
        .select("id, srf_status")
        .single();

      if (error !== null) {
        throw new SrfSubmitError(translate(error.code, error.message));
      }

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
            // The point of the whole exercise: this line and the document that
            // proves it, so the coordinator verifies one against the other.
            marksheet_id:
              documentIds.get(
                marksheetSlotKey({
                  kind: "semester_marksheet",
                  semesterNumber: s.semesterNumber,
                }),
              ) ?? null,
          })),
        );

        if (semesterError !== null) {
          throw new SrfSubmitError(translate(semesterError.code, semesterError.message));
        }
      }

      return { id: studentId, status: data.srf_status as Enums["srf_status"] };
    },

    /**
     * Saves the form as a draft (UAT 2026-08-05).
     *
     * It writes ONLY the draft column. Not srf_status - submitting is what
     * moves the form forward - and not a single verified field, which the
     * 0009 guard would refuse anyway and which would make an auto-save a way
     * of editing marks a coordinator had already checked.
     *
     * It never throws. Auto-save runs while the student is typing, and an
     * exception there would surface as a failure of whatever they were doing.
     * The worst honest outcome is that this attempt is lost and the next one,
     * a few seconds later, succeeds.
     */
    async saveDraft(values) {
      const userId = await getAuthUserId();
      if (userId === null) return false;

      const { error } = await client
        .from("students")
        .update({ srf_draft: values, srf_draft_saved_at: new Date().toISOString() })
        .eq("auth_user_id", userId)
        .select("id")
        .single();

      return error === null;
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
