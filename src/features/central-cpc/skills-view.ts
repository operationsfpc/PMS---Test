import type { AppRole } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreChange, SkillArea, SkillStudentRow, SkillsView } from "./skills-page";

export class SkillsError extends Error {}

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/** Registered in src/db/query-contract.test.ts — every hand-written select is. */
export const SKILL_STUDENT_COLUMNS =
  "id, full_name, roll_number, campuses(name), student_skill_scores(skill_area_id, score)";

/** Who may write to the repository. Mirrors is_operator() in the database. */
const OPERATORS: readonly AppRole[] = ["admin", "central_placement_coordinator"];

/**
 * The Supabase half of the skill repository (PRD §5).
 *
 * A cleared score is a DELETE, never an upsert of zero: zero is a mark, and
 * absence means "not assessed". Every written row names who recorded it —
 * these scores later feed shortlisting, so their provenance matters.
 */
export function createSupabaseSkillsView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): SkillsView {
  async function requireOperator(): Promise<string> {
    if (!OPERATORS.includes(await getActorRole())) {
      throw new SkillsError(
        "Only the Central Placement Coordinator may maintain the skill repository.",
      );
    }
    const actorId = await getActorId();
    if (actorId === null) {
      throw new SkillsError("Your session has expired. Please sign in again.");
    }
    return actorId;
  }

  return {
    async areas() {
      const { data, error } = await client.from("skill_areas").select("id, name").order("name");
      if (error !== null) {
        throw new SkillsError("Could not load the skill areas. Please try again.");
      }
      return (data ?? []).map(
        (row): SkillArea => ({ id: row.id as string, name: row.name as string }),
      );
    },

    async students() {
      const { data, error } = await client
        .from("students")
        .select(SKILL_STUDENT_COLUMNS)
        .order("full_name");
      if (error !== null) {
        throw new SkillsError("Could not load the students. Please try again.");
      }

      return (data ?? []).map((row): SkillStudentRow => {
        const record = row as Record<string, unknown>;
        const campus = one<{ name?: string }>(record.campuses);
        const scoreRows = Array.isArray(record.student_skill_scores)
          ? (record.student_skill_scores as { skill_area_id: string; score: number }[])
          : [];

        return {
          studentId: record.id as string,
          studentName: record.full_name as string,
          rollNumber: record.roll_number as string,
          campusName: campus?.name ?? "—",
          scores: Object.fromEntries(scoreRows.map((s) => [s.skill_area_id, Number(s.score)])),
        };
      });
    },

    async addArea(name) {
      await requireOperator();

      const { data, error } = await client
        .from("skill_areas")
        .insert({ name })
        .select("id, name")
        .single();

      if (error !== null || data === null) {
        throw new SkillsError(
          error?.code === "23505"
            ? `"${name}" already exists — edit the scores under it instead.`
            : "Could not add the skill area. Please try again.",
        );
      }
      return { id: data.id as string, name: data.name as string };
    },

    async saveScores(changes: readonly ScoreChange[]) {
      const actorId = await requireOperator();

      const upserts = changes.filter((c) => c.score !== null);
      const clears = changes.filter((c) => c.score === null);

      if (upserts.length > 0) {
        const { error } = await client.from("student_skill_scores").upsert(
          upserts.map((c) => ({
            student_id: c.studentId,
            skill_area_id: c.skillAreaId,
            score: c.score,
            recorded_by: actorId,
          })),
          { onConflict: "student_id,skill_area_id" },
        );
        if (error !== null) {
          throw new SkillsError("Could not save the scores. Please try again.");
        }
      }

      for (const clear of clears) {
        const { error } = await client
          .from("student_skill_scores")
          .delete()
          .eq("student_id", clear.studentId)
          .eq("skill_area_id", clear.skillAreaId);
        if (error !== null) {
          throw new SkillsError("Could not save the scores. Please try again.");
        }
      }
    },
  };
}
