import { buildApplicationSnapshot, type SnapshotStudent } from "@domain/application-snapshot";
import type { Offer } from "@domain/offers";
import type { AcademicProfile, ParticipationStatus, RoleCategory, SrfStatus } from "@domain/types";
import { canApply, type VisibleDrive } from "@domain/visibility";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ApplyError extends Error {}

export type ApplyStudent = SnapshotStudent & {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly academics: AcademicProfile;
  readonly offers: readonly Offer[];
  /** The areas they asked for (2026-08-18). A drive reaches only those. */
  readonly roleCategories: readonly RoleCategory[];
  /** D2 (UAT 2026-08-19): per-area resume file names, for the apply screen. */
  readonly resumeNames: Readonly<Record<string, string>>;
  /** D1 (UAT 2026-08-19): the drive types they asked for. Empty = every type. */
  readonly driveTypePreferences: readonly import("@domain/types").DriveType[];
};

export type ApplyDrive = VisibleDrive & { readonly roleCategory: RoleCategory };

export interface ApplyRepository {
  apply(
    student: ApplyStudent,
    drive: ApplyDrive,
    appliedDriveIds: readonly string[],
    now: Date,
    /**
     * The resume the student chose for THIS drive (F14, UAT 2026-08-06).
     * Optional so nothing that already applies without one breaks; when it is
     * given it is what the recruiter reads.
     */
    driveResume?: File,
  ): Promise<void>;
}

/** Resumes are private (0010): signed URLs only, never a public path. */
const RESUME_BUCKET = "resumes";

/** R6's refusal codes are not student-facing prose. */
const REFUSALS: Record<string, string> = {
  srf_not_approved: "Your registration form has not been approved yet.",
  opted_out: "You have opted out of campus placements.",
  disbarred: "You are not currently eligible to apply. Contact your coordinator.",
  not_eligible: "You do not meet this drive's eligibility criteria.",
  area_not_chosen:
    "This drive is for an area you did not choose on your registration form. Ask your coordinator if that has changed.",
  drive_type_not_preferred:
    "This drive's type is not among the ones you asked for in your preferences. Update your preferences to see drives like this one.",
  internship_cap_consumed: "You have already accepted an internship offer.",
  placed_at_equal_or_higher:
    "You are already placed at this category or higher, so this drive is not open to you.",
  drive_not_live: "This drive is not open.",
  window_not_open: "Applications for this drive have not opened yet.",
  window_closed: "Applications for this drive have closed.",
  already_applied: "You have already applied to this drive.",
};

/**
 * Applying to a drive.
 *
 * R6 decides whether the student may apply; R7 freezes what the recruiter will
 * see. Both are asked, neither is re-implemented. A refusal never reaches the
 * database, and an application is never written without its snapshot - the
 * snapshot IS the record everything downstream reads.
 *
 * There is no withdrawal once applied (PRD §7.4), so this single gate is the
 * whole of the student's decision.
 */
export function createSupabaseApplyRepository(client: SupabaseClient): ApplyRepository {
  return {
    async apply(student, drive, appliedDriveIds, now, driveResume) {
      const verdict = canApply(
        {
          srfStatus: student.srfStatus,
          participationStatus: student.participationStatus,
          academics: student.academics,
          offers: student.offers,
          roleCategories: student.roleCategories,
        },
        drive,
        now,
        appliedDriveIds,
      );

      if (!verdict.allowed) {
        throw new ApplyError(
          REFUSALS[verdict.reason] ?? "You cannot apply to this drive right now.",
        );
      }

      /**
       * Uploaded only AFTER R6 has allowed the application. A student refused
       * for eligibility must not be charged an upload first, and a stored file
       * with no application row is litter nobody will ever find.
       */
      let driveResumeId: string | null = null;
      if (driveResume !== undefined) {
        // Namespaced by student, which is exactly what the storage policy
        // checks; timestamped so re-applying never collides with an earlier
        // file, since storage_path is unique.
        const path = `${student.id}/${drive.id}-${Date.now()}-${driveResume.name}`;

        const { error: uploadError } = await client.storage
          .from(RESUME_BUCKET)
          .upload(path, driveResume, { contentType: driveResume.type });

        if (uploadError !== null) {
          throw new ApplyError(
            "Could not upload your resume. Check your connection and try again.",
          );
        }

        const { data: document, error: documentError } = await client
          .from("student_documents")
          .insert({
            student_id: student.id,
            kind: "resume",
            role_category: drive.roleCategory,
            // 0033: what keeps this off the student's PROFILE resume slot.
            // Without it, applying to a second drive in the same category
            // would collide on one_resume_per_category.
            drive_id: drive.id,
            /*
             * The OBJECT KEY, not the bucket-qualified path (fixed
             * 2026-08-26, rows repaired by 0063). Written with the bucket in
             * front, it made the recruiter export ask the resumes bucket for
             * `resumes/resumes/<student>/<file>`, so every export failed on
             * the first resume it reached. Every other uploader on this
             * table writes the key.
             */
            storage_path: path,
            size_bytes: driveResume.size,
          })
          .select("id")
          .single();

        if (documentError !== null || document === null) {
          throw new ApplyError("Could not save your resume. Please try again.");
        }

        driveResumeId = document.id as string;
      }

      const snapshot = buildApplicationSnapshot(student, drive.roleCategory, driveResumeId);

      const { error } = await client
        .from("applications")
        .insert({
          drive_id: drive.id,
          student_id: student.id,
          profile_snapshot: snapshot,
          resume_id: snapshot.resumeId,
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new ApplyError(
          error.code === "23505"
            ? "You have already applied to this drive."
            : "Could not submit your application. Please try again.",
        );
      }
    },
  };
}
