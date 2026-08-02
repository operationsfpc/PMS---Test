import type { AppRole, AttendanceStatus, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultsView, RoundParticipant } from "./results-page";
import { createSupabaseRoundsRepository } from "./rounds-repository";

/**
 * Feeds the round-results screen.
 *
 * Participants come from `attendance`, not `applications`: those rows exist
 * only for students the recruiter actually called (Q9), and recording a result
 * for anyone else would silently enrol them in a round they never attended.
 */
export function createSupabaseResultsView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): ResultsView {
  const rounds = createSupabaseRoundsRepository(client, getActorId, getActorRole);

  return {
    async participants(roundId) {
      const [{ data: attendance }, { data: results }] = await Promise.all([
        client
          .from("attendance")
          .select("application_id, status, applications(students(full_name, roll_number))")
          .eq("round_id", roundId),
        client.from("round_results").select("application_id, result").eq("round_id", roundId),
      ]);

      const resultByApplication = new Map(
        (results ?? []).map((r) => [r.application_id as string, r.result as RoundResult]),
      );

      const one = <T>(value: unknown): T | null =>
        (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

      return (attendance ?? [])
        .map((row): RoundParticipant => {
          const application = one<{ students: unknown }>(row.applications);
          const student = one<{ full_name?: string; roll_number?: string }>(application?.students);

          return {
            applicationId: row.application_id as string,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            attendance: row.status as AttendanceStatus,
            result: resultByApplication.get(row.application_id as string) ?? null,
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
    },

    async record(roundId, applicationId, result) {
      // Every row on this screen came from `attendance`, so each one is by
      // definition scheduled.
      await rounds.recordResult(roundId, applicationId, result, true);
    },
  };
}
