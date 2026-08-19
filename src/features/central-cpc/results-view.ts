import type { MeetingSlot } from "@domain/meeting-slots";
import type { AppRole, AttendanceStatus, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveRoundsView, RoundParticipant } from "./results-page";
import { createSupabaseRoundsRepository } from "./rounds-repository";

/** Where F3's proofs live — private, staff-read, operator-write (0053). */
const ADVANCE_PROOF_BUCKET = "advance-proofs";

/** A timestamptz, shaped for a `datetime-local` input, in IST. */
function toDatetimeLocal(iso: string | null): string | null {
  if (iso === null) return null;
  const utc = new Date(iso);
  if (Number.isNaN(utc.getTime())) return null;
  // IST is a fixed +05:30 — no DST to be wrong about.
  const ist = new Date(utc.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}

/** The reverse: what the input holds, stamped as IST. */
const fromDatetimeLocal = (value: string | null): string | null =>
  value === null || value === "" ? null : `${value}:00+05:30`;

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
        .select("id, sequence, name, round_mode, round_scheduled_at, round_interview_link")
        .eq("drive_id", driveId)
        .order("sequence");

      if (error !== null) throw new ResultsViewError("Could not read the drive's rounds.");

      return (data ?? []).map((row) => ({
        roundId: row.id as string,
        sequence: Number(row.sequence),
        name: (row.name as string | null) ?? `Round ${row.sequence}`,
        mode: (row.round_mode as string | null) ?? null,
        scheduledAt: toDatetimeLocal((row.round_scheduled_at as string | null) ?? null),
        interviewLink: (row.round_interview_link as string | null) ?? null,
      }));
    },

    /** F4 (UAT 2026-08-19): the round's details, edited after creation. */
    async updateRound(roundId, details) {
      const { error } = await client
        .from("drive_rounds")
        .update({
          round_mode: details.mode,
          round_scheduled_at: fromDatetimeLocal(details.scheduledAt),
          round_interview_link: details.interviewLink,
        })
        .eq("id", roundId)
        .select("id")
        .single();

      if (error !== null) throw new ResultsViewError("Could not save the round details.");
    },

    /** F5: the bulk upload, matched by roll number against THIS round. */
    async assignSlots(roundId, slots: readonly MeetingSlot[]) {
      const { data, error } = await client
        .from("round_participants")
        .select("application_id, applications(students(roll_number))")
        .eq("round_id", roundId);

      if (error !== null) throw new ResultsViewError("Could not read the round's participants.");

      const one = <T>(value: unknown): T | null =>
        (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

      const byRoll = new Map(
        (data ?? []).map((row) => {
          const application = one<{ students: unknown }>(row.applications);
          const student = one<{ roll_number?: string }>(application?.students);
          return [student?.roll_number ?? "", row.application_id as string];
        }),
      );

      let matched = 0;
      const unmatched: string[] = [];
      for (const slot of slots) {
        const applicationId = byRoll.get(slot.rollNumber);
        if (applicationId === undefined) {
          unmatched.push(slot.rollNumber);
          continue;
        }
        const { error: updateError } = await client
          .from("round_participants")
          .update({
            meeting_link: slot.meetingLink,
            participant_scheduled_at: fromDatetimeLocal(slot.scheduledAt),
          })
          .eq("round_id", roundId)
          .eq("application_id", applicationId)
          .select("id");
        if (updateError === null) matched += 1;
        else unmatched.push(slot.rollNumber);
      }

      return { matched, unmatched };
    },

    /** F5: one student's own link. */
    async setParticipantSlot(roundId, applicationId, meetingLink, scheduledAt) {
      const { error } = await client
        .from("round_participants")
        .update({
          meeting_link: meetingLink,
          participant_scheduled_at: fromDatetimeLocal(scheduledAt),
        })
        .eq("round_id", roundId)
        .eq("application_id", applicationId)
        .select("id");

      if (error !== null) throw new ResultsViewError("Could not save the meeting link.");
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
    async advance(fromRoundId, toRoundId, proof) {
      const advancing = await rounds.nextRoundParticipants(fromRoundId);
      if (advancing.length === 0) return 0;

      /**
       * F3: the proof is uploaded BEFORE the advance (the 0051 order — an
       * object with no row is invisible; a row pointing at nothing is a link
       * that opens nothing), and its loss is non-fatal: the advance is the
       * thing the coordinator came to do.
       */
      if (proof !== null && proof !== undefined) {
        const path = `${fromRoundId}/proof-${Date.now()}-${proof.name}`;
        const { error: uploadError } = await client.storage
          .from(ADVANCE_PROOF_BUCKET)
          .upload(path, proof, { contentType: proof.type });
        if (uploadError === null) {
          await client
            .from("drive_rounds")
            .update({ advance_proof_path: path })
            .eq("id", fromRoundId)
            .select("id");
        }
      }

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
      const [{ data: attendance }, { data: results }, { data: slots }] = await Promise.all([
        client
          .from("attendance")
          .select("application_id, status, applications(students(full_name, roll_number))")
          .eq("round_id", roundId),
        client.from("round_results").select("application_id, result").eq("round_id", roundId),
        client
          .from("round_participants")
          .select("application_id, meeting_link, participant_scheduled_at")
          .eq("round_id", roundId),
      ]);

      const resultByApplication = new Map(
        (results ?? []).map((r) => [r.application_id as string, r.result as RoundResult]),
      );
      const slotByApplication = new Map(
        (slots ?? []).map((s) => [
          s.application_id as string,
          {
            meetingLink: (s.meeting_link as string | null) ?? null,
            scheduledAt: (s.participant_scheduled_at as string | null) ?? null,
          },
        ]),
      );

      const one = <T>(value: unknown): T | null =>
        (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

      return (attendance ?? [])
        .map((row): RoundParticipant => {
          const application = one<{ students: unknown }>(row.applications);
          const student = one<{ full_name?: string; roll_number?: string }>(application?.students);
          const slot = slotByApplication.get(row.application_id as string);

          return {
            applicationId: row.application_id as string,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            attendance: row.status as AttendanceStatus,
            result: resultByApplication.get(row.application_id as string) ?? null,
            meetingLink: slot?.meetingLink ?? null,
            participantScheduledAt: slot?.scheduledAt ?? null,
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
