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
};

export type ApplyDrive = VisibleDrive & { readonly roleCategory: RoleCategory };

export interface ApplyRepository {
  apply(
    student: ApplyStudent,
    drive: ApplyDrive,
    appliedDriveIds: readonly string[],
    now: Date,
  ): Promise<void>;
}

/** R6's refusal codes are not student-facing prose. */
const REFUSALS: Record<string, string> = {
  srf_not_approved: "Your registration form has not been approved yet.",
  opted_out: "You have opted out of campus placements.",
  disbarred: "You are not currently eligible to apply. Contact your coordinator.",
  not_eligible: "You do not meet this drive's eligibility criteria.",
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
    async apply(student, drive, appliedDriveIds, now) {
      const verdict = canApply(
        {
          srfStatus: student.srfStatus,
          participationStatus: student.participationStatus,
          academics: student.academics,
          offers: student.offers,
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

      const snapshot = buildApplicationSnapshot(student, drive.roleCategory);

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
