import type { AppRole, AttendanceStatus, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveRoundsView, RoundParticipant } from "./results-page";
import { createSupabaseRoundsRepository } from "./rounds-repository";

export class ResultsViewError extends Error {}

export interface DriveInProgress {
  readonly driveId: string;
  readonly companyName: string;
  readonly status: string;
}

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
): DriveRoundsView & { drivesInProgress(): Promise<readonly DriveInProgress[]> } {
  const rounds = createSupabaseRoundsRepository(client, getActorId, getActorRole);

  return {
    /** WS6 (2026-08-12): the tabbed rounds screen reads the whole drive. */
    async rounds(driveId) {
      const { data, error } = await client
        .from("drive_rounds")
        .select("id, sequence, name")
        .eq("drive_id", driveId)
        .order("sequence");

      if (error !== null) throw new ResultsViewError("Could not read the drive's rounds.");

      return (data ?? []).map((row) => ({
        roundId: row.id as string,
        sequence: Number(row.sequence),
        name: (row.name as string | null) ?? `Round ${row.sequence}`,
      }));
    },

    /**
     * A24 allows adding a round mid-drive. The sequence is derived from what
     * exists so two coordinators cannot both create "Round 3" at once - the
     * unique key on (drive_id, sequence) refuses the loser.
     */
    async addRound(driveId, name) {
      const { data: existing } = await client
        .from("drive_rounds")
        .select("sequence")
        .eq("drive_id", driveId)
        .order("sequence", { ascending: false })
        .limit(1);

      const next = Number(existing?.[0]?.sequence ?? 0) + 1;

      const { error } = await client
        .from("drive_rounds")
        .insert({ drive_id: driveId, sequence: next, name })
        .select("id")
        .single();

      if (error !== null) throw new ResultsViewError("Could not add the round.");
    },

    /**
     * Q10: only `selected` advances, and advancement is an explicit act. The
     * scheduling is what makes attendance markable and results recordable in
     * the next round — and it is what the student's dashboard reads.
     */
    async advance(fromRoundId, toRoundId) {
      const advancing = await rounds.nextRoundParticipants(fromRoundId);
      if (advancing.length === 0) return 0;
      await rounds.scheduleParticipants(toRoundId, advancing);
      return advancing.length;
    },

    /** The picker for the bare route: drives that are past publishing. */
    async drivesInProgress() {
      const { data, error } = await client
        .from("drives")
        .select("id, company_name, status")
        .in("status", ["live", "applications_closed", "in_rounds"])
        .order("company_name");

      if (error !== null) throw new ResultsViewError("Could not list the drives.");

      return (data ?? []).map((row) => ({
        driveId: row.id as string,
        companyName: row.company_name as string,
        status: row.status as string,
      }));
    },
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
