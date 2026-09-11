import type { RosterStudent } from "@domain/roster-import";
import type { SupabaseClient } from "@supabase/supabase-js";

export class RosterError extends Error {}

export interface RosterImportResult {
  readonly imported: number;
}

export interface RosterRepository {
  importStudents(campusId: string, students: readonly RosterStudent[]): Promise<RosterImportResult>;
}

/**
 * Imports a parsed roster.
 *
 * Every row becomes a login: migration 0009 refuses any address not on the
 * roster. Two consequences shape this:
 *
 *   - Import is IDEMPOTENT. Re-uploading a corrected file is normal, and must
 *     never wipe a student who has already claimed their account and filled in
 *     their SRF. Existing rows are left untouched, not updated.
 *   - An unknown degree is refused by name rather than silently nulled. A
 *     student with no degree can never match a drive's eligibility (R2), so
 *     importing them would create an invisible student.
 */
export function createSupabaseRosterRepository(client: SupabaseClient): RosterRepository {
  return {
    async importStudents(campusId, students) {
      if (students.length === 0) return { imported: 0 };

      const [{ data: degrees }, { data: branches }] = await Promise.all([
        client.from("degrees").select("id, name"),
        client.from("branches").select("id, name"),
      ]);

      const degreeByName = new Map(
        (degrees ?? []).map((d) => [String(d.name).toLowerCase(), d.id as string]),
      );
      const branchByName = new Map(
        (branches ?? []).map((b) => [String(b.name).toLowerCase(), b.id as string]),
      );

      const unknownDegrees = [
        ...new Set(
          students.filter((s) => !degreeByName.has(s.degree.toLowerCase())).map((s) => s.degree),
        ),
      ];

      if (unknownDegrees.length > 0) {
        throw new RosterError(
          `These degrees are not set up in the system: ${unknownDegrees.join(", ")}. Add them first, then re-import.`,
        );
      }

      // A11. A blank branch is legitimate - some degrees have none - but a
      // branch that was written down and is not recognised must not be
      // silently nulled. That student would fail every branch-restricted
      // drive's eligibility (R2) with nothing on screen to explain why.
      const unknownBranches = [
        ...new Set(
          students
            .filter((s) => s.branch.trim() !== "" && !branchByName.has(s.branch.toLowerCase()))
            .map((s) => s.branch),
        ),
      ];

      if (unknownBranches.length > 0) {
        throw new RosterError(
          `These branches are not set up in the system: ${unknownBranches.join(", ")}. Add them first, then re-import.`,
        );
      }

      const rows = students.map((s) => ({
        campus_id: campusId,
        degree_id: degreeByName.get(s.degree.toLowerCase()),
        branch_id: branchByName.get(s.branch.toLowerCase()) ?? null,
        roll_number: s.rollNumber,
        full_name: s.fullName,
        email: s.email,
        passing_year: s.passingYear,
        srf_status: "invited",
      }));

      // ignoreDuplicates: an existing student is left EXACTLY as they are.
      // Re-uploading a corrected roster is routine, and must never reset a
      // student who has already claimed their account and filled in their SRF.
      const { data, error } = await client
        .from("students")
        .upsert(rows, { onConflict: "email", ignoreDuplicates: true })
        .select("id");

      if (error !== null) {
        // 0040 refuses an address that already belongs to a staff account, and
        // names it in the message. The whole batch fails, so passing that
        // through is the difference between a fixable file and an
        // administrator re-uploading the same one into the same silence.
        if (error.code === "23505" && /student or staff/i.test(error.message)) {
          throw new RosterError(error.message);
        }

        throw new RosterError(
          error.code === "42501"
            ? "You do not have permission to import a roster for this campus."
            : "Could not import the roster. Please try again.",
        );
      }

      // F6: seed campus_programmes from the newly imported roster so the students
      // immediately find their programme in the dropdown.
      try {
        await client.rpc("backfill_campus_programmes");
      } catch {
        // Non-blocking best-effort if RPC is unconfigured or unmocked
      }

      return { imported: (data ?? []).length };
    },
  };
}
