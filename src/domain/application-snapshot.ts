import type { RoleCategory } from "./types";

export interface SnapshotResume {
  readonly id: string;
  readonly roleCategory: RoleCategory;
}

export interface SnapshotStudent {
  readonly id: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly overallCgpa: number;
  readonly tenthPercentage: number;
  readonly twelfthPercentage: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly technicalSkills: string;
  readonly resumes: readonly SnapshotResume[];
}

export type SnapshotProfile = Omit<SnapshotStudent, "resumes">;

export interface ApplicationSnapshot {
  readonly profile: SnapshotProfile;
  /** The one resume matching the drive's role category, if the student has one. */
  readonly resumeId: string | null;
}

/**
 * R7 - freezes what the recruiter will be shown.
 *
 * The returned profile is a COPY. A student who edits their profile after
 * applying must not be able to change what a drive already received, and a
 * coordinator correcting a verified figure must not silently rewrite history
 * on a drive already in progress.
 *
 * Only the resume for this drive's role category travels with the application:
 * sending a sales CV to an engineering recruiter is exactly the mistake the
 * per-category resume rule exists to prevent.
 */
export function buildApplicationSnapshot(
  student: SnapshotStudent,
  roleCategory: RoleCategory,
  /**
   * The resume the student attached to THIS application (F14). It wins over
   * the one on file: asking for it and then sending the generic one would be
   * worse than not asking, because everybody would believe the recruiter got
   * the tailored CV.
   */
  driveResumeId?: string | null,
): ApplicationSnapshot {
  const { resumes, ...profile } = student;

  return {
    profile: { ...profile },
    resumeId: driveResumeId ?? resumes.find((r) => r.roleCategory === roleCategory)?.id ?? null,
  };
}

/**
 * What an application must carry before it may be submitted.
 *
 * F14 asked for a drive-specific resume at apply time; D2 (UAT 2026-08-19)
 * relaxed it — "a student's preferred resume … should auto-populate when they
 * apply." The saved per-area resume is the default; a drive-specific upload
 * REPLACES it. Only a student with neither is refused.
 *
 * Returned as a LIST so the screen can name every missing thing at once - a
 * student fixing one item per submit gives up.
 */
export function applicationEvidenceProblems(evidence: {
  readonly hasDriveResume: boolean;
  readonly hasProfileResume: boolean;
}): readonly string[] {
  return evidence.hasDriveResume || evidence.hasProfileResume
    ? []
    : [
        "Upload the resume you want this recruiter to read — you have none on file for this role area.",
      ];
}
