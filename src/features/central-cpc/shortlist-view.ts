import type { ShortlistEntry } from "@domain/recruiter-export";
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
        //
        // 🔴 2026-08-24 (UAT "CGPA showing 0"): the real envelope is
        // `buildApplicationSnapshot`'s `{ profile: { academics: {…}, … } }`.
        // This code read one level too shallow — `snapshot.academics` — so
        // every applicant's CGPA fell back to 0 while their snapshot carried
        // the true figure. The flat reads stay as fallbacks only.
        const envelope = (row.profile_snapshot ?? {}) as Record<string, unknown>;
        const snapshot = (envelope.profile ?? envelope) as Record<string, unknown>;
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
          // The snapshot profile calls them `roleCategories` (what the student
          // asked for); the old `preferredRoleCategories` read matched nothing.
          preferredRoleCategories: Array.isArray(snapshot.roleCategories)
            ? (snapshot.roleCategories as RoleCategory[])
            : Array.isArray(snapshot.preferredRoleCategories)
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

    /**
     * WS8: what leaves the building. Snapshots (R7), never live rows — the
     * recruiter must receive what the shortlist was decided on.
     */
    async exportEntries(driveId) {
      const { data, error } = await client
        .from("applications")
        .select("id, profile_snapshot, shortlist_entries(included)")
        .eq("drive_id", driveId);

      if (error !== null) throw new ShortlistError("Could not read the shortlist for export.");

      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        applicationId: row.id as string,
        included: one<{ included?: boolean }>(row.shortlist_entries)?.included === true,
        snapshot: row.profile_snapshot as ShortlistEntry["snapshot"],
      }));
    },

    /**
     * Answer 5a (2026-08-24): the resumes travel IN the pack. A download
     * failure throws — 5b's principle applies to transport too: a pack
     * silently missing a file reads as a candidate who was never sent.
     */
    async resumeFiles(resumeIds) {
      if (resumeIds.length === 0) return new Map();

      const { data, error } = await client
        .from("student_documents")
        .select("id, storage_path")
        .in("id", resumeIds);

      if (error !== null) throw new ShortlistError("Could not read the resumes for the pack.");

      const files = new Map<string, { data: ArrayBuffer; extension: string }>();
      for (const row of (data ?? []) as Array<{ id: string; storage_path: string }>) {
        const { data: blob, error: downloadError } = await client.storage
          .from("resumes")
          .download(row.storage_path);

        if (downloadError !== null || blob === null) {
          throw new ShortlistError(
            `A resume could not be downloaded (${row.storage_path.split("/").at(-1) ?? row.id}). Try the export again.`,
          );
        }

        const basename = row.storage_path.split("/").at(-1) ?? "";
        const dot = basename.lastIndexOf(".");
        files.set(row.id, {
          data: await blob.arrayBuffer(),
          extension: dot === -1 ? "" : basename.slice(dot).toLowerCase(),
        });
      }

      return files;
    },

    /** PRD §13.2: the data-sharing log. An unlogged export never happened. */
    async logExport(driveId, columns, studentCount) {
      const actorId = await getActorId();
      if (actorId === null) {
        throw new ShortlistError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("recruiter_exports")
        .insert({
          drive_id: driveId,
          exported_by: actorId,
          columns: [...columns],
          student_count: studentCount,
        })
        .select("id");

      if (error !== null) throw new ShortlistError("The export could not be logged.");
    },
  };
}
