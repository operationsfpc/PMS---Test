import { completionReadiness } from "@domain/drive-completion";
import type { MeetingSlot } from "@domain/meeting-slots";
import { type RoundFacts, renumberRounds } from "@domain/round-editing";
import { applicationProgress } from "@domain/student-progress";
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
): DriveRoundsView {
  const rounds = createSupabaseRoundsRepository(client, getActorId, getActorRole);

  return {
    /** WS6 (2026-08-12): the tabbed rounds screen reads the whole drive. */
    async rounds(driveId) {
      const { data, error } = await client
        .from("drive_rounds")
        .select("id, sequence, name, round_mode, round_scheduled_at, round_interview_link, venue")
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
        // G6b: 0004's venue column, finally written by the screen it was for.
        venue: (row.venue as string | null) ?? null,
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
          venue: details.venue,
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
       * UAT 2026-08-21 (live): students marked selected AFTER an earlier
       * advance rebuilt a batch containing someone already in the next round.
       * Her unique key refused the WHOLE insert, and every retry rebuilt the
       * same batch — "Could not schedule the participants", forever. Only
       * the not-yet-scheduled travel, and only they are counted.
       */
      const { data: existing, error: existingError } = await client
        .from("round_participants")
        .select("application_id")
        .eq("round_id", toRoundId);
      if (existingError !== null) {
        throw new ResultsViewError("Could not read who is already in the next round.");
      }
      const already = new Set((existing ?? []).map((row) => row.application_id as string));
      const newcomers = advancing.filter((id) => !already.has(id));
      if (newcomers.length === 0) return 0;

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

      await rounds.scheduleParticipants(toRoundId, newcomers);
      return newcomers.length;
    },

    /**
     * B2 (2026-08-21): what each round has RECORDED — the facts that freeze
     * it. `attendance` counts only past 'scheduled': a scheduled row is the
     * participant fact, already counted.
     */
    async roundFacts(driveId) {
      const { data, error } = await client
        .from("drive_rounds")
        .select(
          "id, round_participants(application_id), round_results(application_id), attendance(application_id, status)",
        )
        .eq("drive_id", driveId);

      if (error !== null) throw new ResultsViewError("Could not read the rounds' facts.");

      const facts = new Map<string, RoundFacts>();
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const rowsOf = (key: string) =>
          (Array.isArray(row[key]) ? row[key] : []) as Array<Record<string, unknown>>;
        facts.set(row.id as string, {
          hasParticipants: rowsOf("round_participants").length > 0,
          hasAttendance: rowsOf("attendance").some((a) => a.status !== "scheduled"),
          hasResults: rowsOf("round_results").length > 0,
        });
      }
      return facts;
    },

    async renameRound(roundId, name) {
      const { error } = await client.from("drive_rounds").update({ name }).eq("id", roundId);
      if (error !== null) {
        // 0057's trigger speaks in a coordinator's words — pass them through.
        throw new ResultsViewError(error.message || "Could not rename the round.");
      }
    },

    /** Delete, then renumber ascending — sequences only ever shift DOWN. */
    async removeRound(driveId, roundId) {
      const { data } = await client
        .from("drive_rounds")
        .select("id, sequence, name")
        .eq("drive_id", driveId)
        .order("sequence");

      const before = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        roundId: row.id as string,
        sequence: Number(row.sequence),
        name: (row.name as string | null) ?? "",
      }));

      const { error } = await client.from("drive_rounds").delete().eq("id", roundId);
      if (error !== null) {
        throw new ResultsViewError(error.message || "Could not remove the round.");
      }

      // The domain owns the renumbering rule; this loop only persists it.
      for (const round of renumberRounds(before, roundId)) {
        const current = before.find((b) => b.roundId === round.roundId);
        if (current !== undefined && current.sequence !== round.sequence) {
          await client
            .from("drive_rounds")
            .update({ sequence: round.sequence })
            .eq("id", round.roundId);
        }
      }
    },

    /**
     * C3: the readiness the completion dialog states — every applicant's
     * stage, judged by the same `applicationProgress` the student sees.
     */
    /**
     * 2026-08-26: the applications on this drive whose student holds a
     * declared offer. Their round row is closed — see round-outcome.ts.
     *
     * Scoped to THIS drive on purpose: a student placed elsewhere has not been
     * offered this job, and closing their row here would be a lie.
     */
    async offerHolders(driveId) {
      const [{ data: offerRows }, { data: applicationRows }] = await Promise.all([
        client.from("offers").select("student_id").eq("drive_id", driveId),
        client.from("applications").select("id, student_id").eq("drive_id", driveId),
      ]);

      const offered = new Set(
        ((offerRows ?? []) as Array<Record<string, unknown>>).map((o) => o.student_id as string),
      );

      return new Set(
        ((applicationRows ?? []) as Array<Record<string, unknown>>)
          .filter((a) => offered.has(a.student_id as string))
          .map((a) => a.id as string),
      );
    },

    async completionFacts(driveId) {
      const [{ data: applications }, { data: roundRows }, { data: offerRows }] = await Promise.all([
        client.from("applications").select("id, student_id").eq("drive_id", driveId),
        client
          .from("drive_rounds")
          .select(
            "id, sequence, name, round_participants(application_id), round_results(application_id, result), attendance(application_id, status)",
          )
          .eq("drive_id", driveId),
        client.from("offers").select("student_id").eq("drive_id", driveId),
      ]);

      const offered = new Set(
        ((offerRows ?? []) as Array<Record<string, unknown>>).map((o) => o.student_id as string),
      );

      const stages = ((applications ?? []) as Array<Record<string, unknown>>).map((application) => {
        const applicationId = application.id as string;
        const roundFacts = ((roundRows ?? []) as Array<Record<string, unknown>>)
          .map((round) => {
            const rowsOf = (key: string) =>
              (Array.isArray(round[key]) ? round[key] : []).filter(
                (entry) => (entry as Record<string, unknown>).application_id === applicationId,
              ) as Array<Record<string, unknown>>;
            return {
              sequence: Number(round.sequence ?? 0),
              name: String(round.name ?? "Round"),
              participating: rowsOf("round_participants").length > 0,
              attendance:
                (rowsOf("attendance")[0]?.status as
                  | "scheduled"
                  | "present"
                  | "absent"
                  | "provisional"
                  | undefined) ?? null,
              result: (rowsOf("round_results")[0]?.result as RoundResult | undefined) ?? null,
            };
          })
          .sort((a, b) => a.sequence - b.sequence);

        return applicationProgress({
          rounds: roundFacts,
          hasOffer: offered.has(application.student_id as string),
        });
      });

      return completionReadiness(stages);
    },

    async completeDrive(driveId, reason) {
      const { error } = await client
        .from("drives")
        .update({ status: "completed", completed_reason: reason })
        .eq("id", driveId);
      if (error !== null) {
        throw new ResultsViewError(error.message || "Could not complete the drive.");
      }
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
