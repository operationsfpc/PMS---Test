import type { AppRole, RoleCategory } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShortlistApplicant, ShortlistDrive, ShortlistView } from "./shortlist-page";

export class ShortlistError extends Error {}

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Feeds the shortlisting workspace.
 *
 * Applicant data comes from the application SNAPSHOT (R7), never the live
 * student profile. A student who improved their CGPA after applying must not
 * be ranked on numbers the recruiter's criteria were never evaluated against.
 */
export function createSupabaseShortlistView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): ShortlistView {
  return {
    async drive(driveId) {
      const { data } = await client
        .from("drives")
        .select("id, company_name, role_title, role_category, mandatory_skills")
        .eq("id", driveId)
        .single();

      const row = (data ?? {}) as Record<string, unknown>;
      const skills = row.mandatory_skills;

      return {
        driveId,
        companyName: (row.company_name as string | null) ?? "This drive",
        roleTitle: (row.role_title as string | null) ?? null,
        roleCategory: (row.role_category as RoleCategory | null) ?? null,
        mandatorySkills: Array.isArray(skills)
          ? skills.map(String)
          : typeof skills === "string" && skills.trim() !== ""
            ? skills.split(",").map((s) => s.trim())
            : [],
      } satisfies ShortlistDrive;
    },

    async applicants(driveId) {
      const { data: applications } = await client
        .from("applications")
        .select(
          "id, student_id, profile_snapshot, students(full_name, roll_number, participation_status), shortlist_entries(included)",
        )
        .eq("drive_id", driveId);

      const studentIds = (applications ?? []).map((a) => a.student_id as string);
      // The Central Student Skill Repository (0037). Scores are already on
      // the 0-100 scale R11 expects (A35), and each is named by its
      // skill-area row - the same names a drive's mandatory skills refer to.
      const { data: skills } =
        studentIds.length === 0
          ? { data: [] }
          : await client
              .from("student_skill_scores")
              .select("student_id, score, skill_areas(name)")
              .in("student_id", studentIds);

      const skillsByStudent = new Map<string, { skill: string; score: number }[]>();
      for (const row of skills ?? []) {
        const area = one<{ name?: string }>(row.skill_areas);
        // No area row, no name - an unnameable score cannot be matched
        // against a drive's required skills, so it is dropped, not invented.
        if (area?.name === undefined) continue;
        const list = skillsByStudent.get(row.student_id as string) ?? [];
        list.push({ skill: area.name, score: Number(row.score) });
        skillsByStudent.set(row.student_id as string, list);
      }

      return (applications ?? []).map((row): ShortlistApplicant => {
        // R7: the snapshot is the truth for everything downstream.
        const snapshot = (row.profile_snapshot ?? {}) as Record<string, unknown>;
        const student = one<{
          full_name?: string;
          roll_number?: string;
          participation_status?: string;
        }>(row.students);
        const academics = (snapshot.academics ?? snapshot) as Record<string, unknown>;

        return {
          applicationId: row.id as string,
          studentName:
            (snapshot.fullName as string | undefined) ?? student?.full_name ?? "Unknown student",
          rollNumber: (snapshot.rollNumber as string | undefined) ?? student?.roll_number ?? "—",
          overallCgpa: Number(academics.overallCgpa ?? 0),
          currentArrears: Number(academics.currentArrears ?? 0),
          historyOfArrears: Number(academics.historyOfArrears ?? 0),
          skillScores: skillsByStudent.get(row.student_id as string) ?? [],
          preferredRoleCategories: Array.isArray(snapshot.preferredRoleCategories)
            ? (snapshot.preferredRoleCategories as RoleCategory[])
            : [],
          shortlisted: one<{ included?: boolean }>(row.shortlist_entries)?.included === true,
          // D7: read LIVE, not from the snapshot — the whole point is that
          // the student opted out AFTER the snapshot was taken.
          optedOut: student?.participation_status === "opted_out",
        };
      });
    },

    async saveShortlist(_driveId, decisions) {
      if ((await getActorRole()) !== "central_placement_coordinator") {
        throw new ShortlistError("Only the Central Placement Coordinator may shortlist.");
      }

      const actorId = await getActorId();
      if (actorId === null) {
        throw new ShortlistError("Your session has expired. Please sign in again.");
      }

      if (decisions.length === 0) return;

      // One row per application (the column is unique), carrying BOTH the
      // recommendation and the decision - PRD 13.1. Upsert, because the
      // coordinator will revise a shortlist more than once.
      const { error } = await client
        .from("shortlist_entries")
        .upsert(
          decisions.map((decision) => ({
            application_id: decision.applicationId,
            included: decision.included,
            rank: decision.rank,
            score: decision.score,
            rationale: decision.rationale,
            decided_by: actorId,
            // D7: null for everyone active; the trigger refuses an opted-out
            // inclusion without it.
            opt_out_override_reason: decision.optOutOverrideReason,
          })),
          { onConflict: "application_id" },
        )
        .select("id");

      if (error !== null) throw new ShortlistError("Could not save the shortlist.");
    },
  };
}
