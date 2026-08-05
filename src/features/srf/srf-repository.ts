import { normaliseToCgpa } from "@domain/marks";
import {
  type MarksheetKind,
  marksheetSlotKey,
  marksheetSlots,
  missingMarksheets,
} from "@domain/marksheets";
import { normaliseProfileLinks } from "@domain/profile-links";
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

/** One uploaded marksheet, as the transaction needs to hear about it. */
interface MarksheetUpload {
  /** The form's own key ("tenth", "semester-3"), used to link declarations. */
  readonly slot: string;
  readonly kind: MarksheetKind;
  readonly storage_path: string;
  readonly size_bytes: number;
}

/**
 * Puts every marksheet in storage and describes what landed there.
 *
 * It no longer INSERTS the document rows. It used to, purely to learn their
 * ids so the semester lines could point at them - and that is why a failed
 * submission left rows behind for files nobody would ever verify: 34 orphans
 * for one student on 2026-08-05. The rows are now written inside `submit_srf`,
 * in the same transaction as the marks they evidence, and the slot key is what
 * ties a declaration to its document until the ids exist.
 *
 * The upload itself cannot join that transaction - storage is not the database
 * - so it happens FIRST. An object with no row is invisible and costs a few
 * kilobytes; a row with no object would ask a coordinator to verify a figure
 * against a document that is not there.
 */
async function uploadMarksheets(
  client: SupabaseClient,
  studentId: string,
  values: SrfSubmission,
): Promise<MarksheetUpload[]> {
  /**
   * EVERY slot the form offers, not just the required ones.
   *
   * Iterating the required list would silently discard an optional diploma or
   * consolidated UG marksheet the student had actually uploaded - which is
   * precisely the defect this whole area was built to fix.
   */
  const slots = marksheetSlots({
    ...values,
    hasDiplomaMarks: values.diplomaMarks !== null,
  });

  const files = slots.flatMap((slot) => {
    const file = values.marksheets[slot.key];
    return file === undefined ? [] : [{ slot, file }];
  });

  const uploads: MarksheetUpload[] = [];

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

    uploads.push({
      slot: slot.key,
      kind: slot.kind,
      storage_path: path,
      size_bytes: file.size,
    });
  }

  return uploads;
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
      const missing = missingMarksheets(
        { ...values, hasDiplomaMarks: values.diplomaMarks !== null },
        Object.keys(values.marksheets),
      );
      if (missing.length > 0) {
        throw new SrfSubmitError(
          `Upload your ${missing.map((s) => s.label).join(", ")} before submitting.`,
        );
      }

      /**
       * The student's own id, resolved before anything is written, because the
       * storage policy (0022) requires every object to sit under it.
       */
      const { data: own, error: ownError } = await client
        .from("students")
        .select("id")
        .eq("auth_user_id", userId)
        .single();

      if (ownError !== null || own === null) {
        throw new SrfSubmitError(translate(ownError?.code, ownError?.message ?? ""));
      }

      const uploads = await uploadMarksheets(client, own.id as string, values);

      /**
       * ONE call, one transaction (0028).
       *
       * This was four requests - insert the documents, update the student,
       * delete the semester lines, insert the new ones - and PostgREST gives
       * each its own transaction. A failure at the third committed the first
       * two, which is how the live database came to hold a student row saying
       * `srf_submitted` while the student was correctly being told that
       * submission had failed. All of it lands now, or none of it does.
       *
       * Nothing here names the student. `submit_srf` reads that from the
       * session, so the payload has no identity to tamper with.
       */
      const { data, error } = await client.rpc("submit_srf", {
        p_student: {
          full_name: values.fullName,
          mobile: values.mobile,
          whatsapp: values.whatsapp === "" ? null : values.whatsapp,
          alternate_contact: values.alternateContact === "" ? null : values.alternateContact,
          tenth_institution: values.tenthInstitution,
          tenth_percentage: values.tenthPercentage,
          twelfth_institution: values.twelfthInstitution,
          twelfth_percentage: values.twelfthPercentage,
          // All-or-nothing, enforced by the DB too (0024): a declared figure
          // with no college and no marksheet is a mark nobody can verify.
          diploma_institution:
            values.diplomaMarks === null || values.diplomaInstitution === ""
              ? null
              : values.diplomaInstitution,
          diploma_marks: values.diplomaMarks,
          diploma_marks_scale: values.diplomaMarks === null ? null : values.diplomaMarksScale,
          diploma_marksheet_slot: "diploma",
          passing_year: values.passingYear,
          programme_level: values.programmeLevel,
          // A postgraduate's finished degree: where, in what, and how well.
          ug_degree: values.programmeLevel === "pg" ? values.ugDegree : null,
          ug_college: values.programmeLevel === "pg" ? values.ugCollege : null,
          ug_branch: values.programmeLevel === "pg" ? values.ugBranch : null,
          // Declared as typed; normalised for every cutoff comparison (A33).
          ug_aggregate_declared: values.ugAggregate,
          ug_aggregate_scale: values.ugAggregate === null ? null : values.ugAggregateScale,
          ug_aggregate_cgpa:
            values.ugAggregate === null
              ? null
              : normaliseToCgpa(values.ugAggregate, values.ugAggregateScale),
          // A postgraduate's UG aggregate stands in for an entire degree, so
          // it is evidenced like any other declared mark (A31).
          ug_marksheet_slot: "ug_consolidated",
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
          // Trimmed, with rows the student added and abandoned dropped. The
          // domain owns that rule so the stored list matches what validation
          // judged, rather than what the form happened to be holding.
          other_profiles: normaliseProfileLinks(values.otherProfiles),
        },
        p_semesters: values.semesters.map((s) => ({
          semester_number: s.semesterNumber,
          // Both, deliberately: `cgpa` is the only figure a cutoff can be
          // compared against, `declared_marks` is what the student typed and
          // what the coordinator finds on the marksheet.
          cgpa: normaliseToCgpa(s.marks, values.collegeMarksScale),
          declared_marks: s.marks,
          // One scale for the whole degree (2026-08-06), still recorded on
          // every row so a stored figure always says what it means.
          marks_scale: values.collegeMarksScale,
          current_arrears: s.currentArrears,
          history_of_arrears: s.historyOfArrears,
          // The point of the whole exercise: this line and the document that
          // proves it, so the coordinator verifies one against the other.
          marksheet_slot: marksheetSlotKey({
            kind: "semester_marksheet",
            semesterNumber: s.semesterNumber,
          }),
        })),
        p_documents: uploads,
      });

      if (error !== null) {
        throw new SrfSubmitError(translate(error.code, error.message));
      }

      // `returns table (...)` comes back as a one-row array unless PostgREST is
      // told otherwise; supabase-js hands back whichever it received.
      const row = (Array.isArray(data) ? data[0] : data) as {
        student_id: string;
        srf_status: Enums["srf_status"];
      };

      return { id: row.student_id, status: row.srf_status };
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
  // PGRST116: PostgREST found no row. P0002: `submit_srf` refused for the same
  // reason - a session with no student record behind it. One cause, one answer.
  if (code === "PGRST116" || code === "P0002") {
    return "We could not find your student record. Contact your placement coordinator.";
  }
  /**
   * A semester line that survived the clear-out, because 0027 lets a student
   * remove only their own PENDING rows. So this is a line a coordinator has
   * already verified - which is a person to talk to, not a fault to retry.
   */
  if (code === "23505" && /student_semesters_student_id_semester_number/.test(message)) {
    return "Verified academic data can only be changed by your placement coordinator.";
  }
  return "Could not submit your form. Please try again.";
}
