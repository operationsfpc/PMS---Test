import type { SupabaseClient } from "@supabase/supabase-js";

export class ProgrammesError extends Error {}

export interface BranchItem {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface DegreeItem {
  readonly id: string;
  readonly name: string;
  readonly branches: readonly BranchItem[];
}

export interface ProgrammesRepository {
  list(): Promise<readonly DegreeItem[]>;
  addDegree(name: string): Promise<void>;
  addBranch(degreeId: string, name: string): Promise<void>;
  setBranchActive(branchId: string, isActive: boolean): Promise<void>;
}

/**
 * Degrees and branches.
 *
 * Roster import matches these BY NAME and refuses an unknown degree or an
 * unknown non-blank branch (A11), so what is stored here decides which
 * students can be imported at all.
 */
export function createSupabaseProgrammesRepository(client: SupabaseClient): ProgrammesRepository {
  return {
    async list() {
      const [{ data: degrees, error }, { data: branches }] = await Promise.all([
        client.from("degrees").select("id, name").order("name"),
        client.from("branches").select("id, degree_id, name, is_active").order("name"),
      ]);

      if (error !== null) throw new ProgrammesError("Could not load the degrees.");

      const byDegree = new Map<string, BranchItem[]>();
      for (const branch of branches ?? []) {
        const list = byDegree.get(branch.degree_id as string) ?? [];
        list.push({
          id: branch.id as string,
          name: branch.name as string,
          isActive: branch.is_active as boolean,
        });
        byDegree.set(branch.degree_id as string, list);
      }

      return (degrees ?? []).map(
        (degree): DegreeItem => ({
          id: degree.id as string,
          name: degree.name as string,
          branches: byDegree.get(degree.id as string) ?? [],
        }),
      );
    },

    async addDegree(name) {
      const { error } = await client
        .from("degrees")
        .insert({ name: name.trim() })
        .select("id")
        .single();

      if (error !== null) {
        throw new ProgrammesError(
          error.code === "23505"
            ? "That degree already exists."
            : "Could not add the degree. Please try again.",
        );
      }
    },

    async addBranch(degreeId, name) {
      const { error } = await client
        .from("branches")
        .insert({ degree_id: degreeId, name: name.trim() })
        .select("id")
        .single();

      if (error !== null) {
        throw new ProgrammesError(
          error.code === "23505"
            ? "That branch already exists for this degree."
            : "Could not add the branch. Please try again.",
        );
      }
    },

    async setBranchActive(branchId, isActive) {
      const { error } = await client
        .from("branches")
        .update({ is_active: isActive })
        .eq("id", branchId)
        .select("id")
        .single();

      if (error !== null) throw new ProgrammesError("Could not update the branch.");
    },
  };
}
