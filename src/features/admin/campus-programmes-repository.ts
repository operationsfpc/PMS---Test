import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampusProgrammesView, DegreeOption, ProgrammeRow } from "./campus-programmes";

export class CampusProgrammeError extends Error {}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const CAMPUS_PROGRAMME_COLUMNS = `
  id, passing_year, degrees(name), branches(name)
`;

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/**
 * What a college runs, against live rows. F6 (UAT 2026-08-06).
 *
 * The screen speaks in NAMES, because that is what an Admin reads and types.
 * The table stores ids. Resolving one to the other is this layer's only real
 * job — and getting it wrong pairs a degree with another degree's branch,
 * which 0036's trigger then refuses, correctly but unhelpfully.
 *
 * A name that is not in the catalogue is created here, scoped where it
 * belongs: a new degree joins the catalogue, a new branch joins its degree.
 * The old separate catalogue screen is gone (F6), so refusing a typed name
 * would leave an Admin with nowhere to add it at all. Matching is
 * case-insensitive on the trimmed name — "b.e" resolves to the existing
 * "B.E" instead of seeding a near-duplicate.
 */
export function createSupabaseCampusProgrammesView(client: SupabaseClient): CampusProgrammesView {
  async function catalogue() {
    const [{ data: degrees }, { data: branches }] = await Promise.all([
      client.from("degrees").select("id, name"),
      client.from("branches").select("id, degree_id, name"),
    ]);

    return { degrees: rows(degrees), branches: rows(branches) };
  }

  return {
    async programmes(campusId) {
      const { data } = await client
        .from("campus_programmes")
        .select(CAMPUS_PROGRAMME_COLUMNS)
        .eq("campus_id", campusId);

      return rows(data).map(
        (row): ProgrammeRow => ({
          id: row.id as string,
          degree: one<{ name?: string }>(row.degrees)?.name ?? "",
          // Null is a real answer: an MBA has no branches.
          branch: one<{ name?: string }>(row.branches)?.name ?? "",
          passingYear: Number(row.passing_year ?? 0),
        }),
      );
    },

    async options() {
      const { degrees, branches } = await catalogue();

      return degrees.map(
        (degree): DegreeOption => ({
          degree: degree.name as string,
          branches: branches
            .filter((branch) => branch.degree_id === degree.id)
            .map((branch) => branch.name as string)
            .sort((a, b) => a.localeCompare(b)),
        }),
      );
    },

    async add(programme) {
      const degreeName = programme.degree.trim();
      const branchName = programme.branch.trim();
      const sameName = (a: unknown, b: string) =>
        String(a ?? "").trim().toLowerCase() === b.toLowerCase();

      let { degrees, branches } = await catalogue();

      let degree = degrees.find((d) => sameName(d.name, degreeName));
      if (degree === undefined) {
        // A 23505 here means a concurrent Admin just created it — re-reading
        // resolves the id in either case.
        const { error } = await client.from("degrees").insert({ name: degreeName });
        if (error !== null && error.code !== "23505") {
          throw new CampusProgrammeError(`Could not add the degree ${degreeName}: ${error.message}`);
        }
        ({ degrees } = await catalogue());
        degree = degrees.find((d) => sameName(d.name, degreeName));
        if (degree === undefined) {
          throw new CampusProgrammeError(`Could not add the degree ${degreeName}.`);
        }
      }

      // Looked up WITHIN the degree, so a branch name shared by two degrees
      // cannot resolve to the wrong one.
      let branch =
        branchName === ""
          ? null
          : (branches.find(
              (b) => b.degree_id === degree?.id && sameName(b.name, branchName),
            ) ?? null);

      if (branchName !== "" && branch === null) {
        const { error } = await client
          .from("branches")
          .insert({ degree_id: degree.id, name: branchName });
        if (error !== null && error.code !== "23505") {
          throw new CampusProgrammeError(
            `Could not add the branch ${branchName}: ${error.message}`,
          );
        }
        ({ branches } = await catalogue());
        branch =
          branches.find(
            (b) => b.degree_id === degree?.id && sameName(b.name, branchName),
          ) ?? null;
        if (branch === null) {
          throw new CampusProgrammeError(`Could not add the branch ${branchName}.`);
        }
      }

      const { error } = await client.from("campus_programmes").insert({
        campus_id: programme.campusId,
        degree_id: degree.id as string,
        branch_id: branch === null ? null : (branch.id as string),
        passing_year: programme.passingYear,
      });

      if (error !== null) {
        throw new CampusProgrammeError(
          error.code === "23505"
            ? "This college already runs that programme for that year."
            : `Could not add that programme: ${error.message}`,
        );
      }
    },

    async remove(programmeId) {
      const { error } = await client.from("campus_programmes").delete().eq("id", programmeId);

      if (error !== null) {
        throw new CampusProgrammeError(
          error.code === "23503"
            ? "Students are already registered against it, so it cannot be removed."
            : "Could not remove that programme.",
        );
      }
    },
  };
}
