import { type MarksScale, normaliseToCgpa } from "@domain/marks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddSemesterView } from "./add-semester";

export class AddSemesterError extends Error {}

/** Private since 0010, and the path must start with the student's own id (0022). */
const MARKSHEET_BUCKET = "marksheets";

/**
 * A semester that finished after the form was approved. F13 (UAT 2026-08-06).
 *
 * The marksheet goes to storage first, then its document row, then the
 * semester line pointing at it. `student_semesters.marksheet_id` is NOT NULL
 * (0023), so a line with no document cannot be written at all — which is the
 * correct outcome rather than something to route around.
 *
 * The line is written `pending`. That is the whole point: `academicStandingFrom`
 * counts only VERIFIED semesters, so nothing a student adds here changes their
 * eligibility until a coordinator has compared it to the document beside it.
 * There is no update path either — a figure already on the record belongs to
 * the coordinator who checked it.
 */
export function createSupabaseAddSemesterView(
  client: SupabaseClient,
  getStudentId: () => Promise<string | null>,
  /** One scale per degree, chosen on the form and unchanging (2026-08-06). */
  marksScale: MarksScale,
): AddSemesterView {
  return {
    async add(semester) {
      const studentId = await getStudentId();
      if (studentId === null) {
        throw new AddSemesterError("Your session has expired. Please sign in again.");
      }

      // Namespaced by student id because that is exactly what the storage
      // policy checks, and stamped so a re-upload never collides.
      const path = `${studentId}/semester-${semester.semesterNumber}-${Date.now()}-${
        semester.marksheet.name
      }`;

      const { error: uploadError } = await client.storage
        .from(MARKSHEET_BUCKET)
        .upload(path, semester.marksheet, { contentType: semester.marksheet.type });

      if (uploadError !== null) {
        throw new AddSemesterError(
          "Could not upload your marksheet. Check your connection and try again.",
        );
      }

      const { data: document, error: documentError } = await client
        .from("student_documents")
        .insert({
          student_id: studentId,
          kind: "semester_marksheet",
          storage_path: path,
          size_bytes: semester.marksheet.size,
        })
        .select("id")
        .single();

      if (documentError !== null || document === null) {
        throw new AddSemesterError("Could not save your marksheet. Please try again.");
      }

      /**
       * 2026-08-24 (0061): a rejected declaration is replaced, not merely
       * duplicated into a unique-key refusal. The delete is scoped to THIS
       * student, THIS semester, and REJECTED rows only — a pending or
       * verified line is never touched from here (RLS refuses the verified
       * one regardless). Deleting nothing is the ordinary case and is fine.
       */
      await client
        .from("student_semesters")
        .delete()
        .eq("student_id", studentId)
        .eq("semester_number", semester.semesterNumber)
        .eq("status", "rejected");

      const { error } = await client
        .from("student_semesters")
        .insert({
          student_id: studentId,
          semester_number: semester.semesterNumber,
          // Both, deliberately: `cgpa` is the only figure a cutoff can be
          // compared against, `declared_marks` is what the student typed and
          // what the coordinator finds on the marksheet.
          cgpa: normaliseToCgpa(semester.marks, marksScale),
          declared_marks: semester.marks,
          marks_scale: marksScale,
          current_arrears: semester.currentArrears,
          history_of_arrears: semester.historyOfArrears,
          marksheet_id: document.id as string,
          // Said out loud rather than left to the column default: F13's whole
          // requirement is that these marks are not trusted until checked.
          status: "pending",
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new AddSemesterError(
          error.code === "23505"
            ? `Semester ${semester.semesterNumber} is already on your record. Ask your coordinator to correct it.`
            : "Could not add this semester. Please try again.",
        );
      }
    },
  };
}
