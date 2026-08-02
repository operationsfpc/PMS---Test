import { advancingParticipants, canMarkAttendance, canRecordResult } from "@domain/rounds";
import type { AppRole, AttendanceStatus, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class RoundsError extends Error {}

export interface RoundsRepository {
  /** The recruiter's chosen participants, uploaded by the Central CPC (Q9). */
  scheduleParticipants(roundId: string, applicationIds: readonly string[]): Promise<void>;
  markAttendance(
    roundId: string,
    applicationId: string,
    status: AttendanceStatus,
    isScheduled: boolean,
  ): Promise<void>;
  recordResult(
    roundId: string,
    applicationId: string,
    result: RoundResult,
    isScheduled: boolean,
  ): Promise<void>;
  nextRoundParticipants(roundId: string): Promise<readonly string[]>;
}

export type GetActorId = () => Promise<string | null>;
export type GetActorRole = () => Promise<AppRole>;

/**
 * Rounds, attendance and results.
 *
 * Every permission question is answered by `src/domain/rounds.ts`. The
 * important consequence: a student the recruiter never called can never be
 * marked absent, so they can never accumulate the three absences that trigger
 * a disbarment review (R8).
 */
export function createSupabaseRoundsRepository(
  client: SupabaseClient,
  getActorId: GetActorId,
  getActorRole: GetActorRole,
): RoundsRepository {
  async function actor() {
    const id = await getActorId();
    if (id === null) throw new RoundsError("Your session has expired. Please sign in again.");
    return id;
  }

  return {
    async scheduleParticipants(roundId, applicationIds) {
      const actorId = await actor();

      const { error } = await client
        .from("round_participants")
        .insert(
          applicationIds.map((applicationId) => ({
            round_id: roundId,
            application_id: applicationId,
            added_by: actorId,
          })),
        )
        .select("id");

      if (error !== null) throw new RoundsError("Could not schedule the participants.");

      // Scheduling is what makes attendance markable at all, so the rows are
      // created together rather than lazily on first mark.
      const { error: attendanceError } = await client
        .from("attendance")
        .insert(
          applicationIds.map((applicationId) => ({
            round_id: roundId,
            application_id: applicationId,
            status: "scheduled",
          })),
        )
        .select("id");

      if (attendanceError !== null) {
        throw new RoundsError("Participants were scheduled but attendance could not be prepared.");
      }
    },

    async markAttendance(roundId, applicationId, status, isScheduled) {
      const permission = canMarkAttendance(await getActorRole(), isScheduled);
      if (!permission.allowed) throw new RoundsError(permission.reason);

      const actorId = await actor();

      const { error } = await client
        .from("attendance")
        .update({ status, marked_by: actorId, marked_at: new Date().toISOString() })
        .eq("round_id", roundId)
        .eq("application_id", applicationId)
        .select("id")
        .single();

      if (error !== null) throw new RoundsError("Could not save attendance. Please try again.");
    },

    async recordResult(roundId, applicationId, result, isScheduled) {
      const permission = canRecordResult(await getActorRole(), isScheduled);
      if (!permission.allowed) throw new RoundsError(permission.reason);

      const actorId = await actor();

      // A15: one student, one round, one CURRENT result. Corrections and Q10
      // promotions (waitlisted -> selected) replace the row; the audit trigger
      // keeps the previous value. A plain insert would die on the unique key.
      const { error } = await client
        .from("round_results")
        .upsert(
          {
            round_id: roundId,
            application_id: applicationId,
            result,
            declared_by: actorId,
          },
          { onConflict: "round_id,application_id" },
        )
        .select("id")
        .single();

      if (error !== null) throw new RoundsError("Could not record the result. Please try again.");
    },

    async nextRoundParticipants(roundId) {
      const { data, error } = await client
        .from("round_results")
        .select("application_id, result")
        .eq("round_id", roundId);

      if (error !== null) throw new RoundsError("Could not read the round's results.");

      return advancingParticipants(
        (data ?? []).map((row) => ({
          studentId: row.application_id as string,
          result: row.result as RoundResult,
        })),
      );
    },
  };
}
