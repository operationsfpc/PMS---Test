import { completionReadiness } from "@domain/drive-completion";
import type { SlotAssignment } from "@domain/meeting-slots";
import { type RoundFacts, renumberRounds } from "@domain/round-editing";
import { sanitizeStorageFileName } from "@domain/storage-path";
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

export class ResultsViewError extends Error {}

/**
 * The reverse: what the input holds, stamped as IST.
 *
 * UAT 2026-08-27 (live): a CSV time of `1pm` came through here untouched and
 * was sent as `1pm:00+05:30`. Postgres refused every row, and the only
 * wording the upload screen had for a refused row was "no participant carries
 * these roll numbers" — so two students who were plainly in the round were
 * blamed for a malformed timestamp. The shape is now checked before it is
 * stamped: nothing is written, and the message names the real cause.
 */
const fromDatetimeLocal = (value: string | null): string | null => {
  if (value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new ResultsViewError(
      `"${value}" is not a date and time this round can store. Write it as 2026-09-01 13:00.`,
    );
  }
  return `${value}:00+05:30`;
};

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
      const isVirtual = details.mode === "virtual";
      const isPhysical =
        details.mode === "on_campus" || details.mode === "physical_outside_campus";

      const { error } = await client
        .from("drive_rounds")
        .update({
          round_mode: details.mode,
          round_scheduled_at: fromDatetimeLocal(details.scheduledAt),
          round_interview_link: isVirtual ? details.interviewLink : null,
          venue: isPhysical ? details.venue : null,
        })
        .eq("id", roundId)
        .select("id")
        .single();

      if (error !== null) throw new ResultsViewError("Could not save the round details.");
    },

    /**
     * F5: the bulk upload.
     *
     * UAT 2026-08-26: this used to decide FOR ITSELF who was in the round, by
     * re-reading roll numbers through a nested embed, and answered "no
     * participant carries these roll numbers" about students the screen was
     * displaying. Matching is now the domain's job against the roster on
     * screen (`matchMeetingSlots`); what arrives here is application ids.
     *
     * The other half of that bug: PostgREST answers an UPDATE that matched no
     * row with 200 and an empty list. Counting `error === null` as success
     * therefore reported links that were never stored. A row that is missing
     * is CREATED and then updated — the update is what fires 0054's
     * `meeting_slot_reaches_student`, so the student is actually told.
     */
    async assignSlots(roundId, assignments: readonly SlotAssignment[]) {
      if (assignments.length === 0) return { matched: 0, unmatched: [] };

      let matched = 0;
      const unmatched: string[] = [];

      const writeSlot = async (assignment: SlotAssignment) =>
        await client
          .from("round_participants")
          .update({
            meeting_link: assignment.meetingLink,
            participant_scheduled_at: fromDatetimeLocal(assignment.scheduledAt),
          })
          .eq("round_id", roundId)
          .eq("application_id", assignment.applicationId)
          .select("id");

      for (const assignment of assignments) {
        const first = await writeSlot(assignment);
        if (first.error !== null) {
          unmatched.push(assignment.rollNumber);
          continue;
        }
        if ((first.data ?? []).length > 0) {
          matched += 1;
          continue;
        }

        // No row to update: the participant row is missing though the student
        // is scheduled. Create it empty, then write the slot into it.
        const actorId = await getActorId();
        const { error: insertError } = await client
          .from("round_participants")
          .insert([
            { round_id: roundId, application_id: assignment.applicationId, added_by: actorId },
          ])
          .select("id");
        if (insertError !== null) {
          unmatched.push(assignment.rollNumber);
          continue;
        }

        const second = await writeSlot(assignment);
        if (second.error === null) matched += 1;
        else unmatched.push(assignment.rollNumber);
      }

      return { matched, unmatched };
    },

    /**
     * F5: one student's own link. Same repair as `assignSlots` (2026-08-26):
     * an UPDATE that matches no row is a 200 with an empty body, so "saved"
     * was printed over a link that had gone nowhere.
     */
    async setParticipantSlot(roundId, applicationId, meetingLink, scheduledAt) {
      const write = async () =>
        await client
          .from("round_participants")
          .update({
            meeting_link: meetingLink,
            participant_scheduled_at: fromDatetimeLocal(scheduledAt),
          })
          .eq("round_id", roundId)
          .eq("application_id", applicationId)
          .select("id");

      const { data, error } = await write();
      if (error !== null) throw new ResultsViewError("Could not save the meeting link.");

      if ((data ?? []).length === 0) {
        const actorId = await getActorId();
        const { error: insertError } = await client
          .from("round_participants")
          .insert([{ round_id: roundId, application_id: applicationId, added_by: actorId }])
          .select("id");
        if (insertError !== null) throw new ResultsViewError("Could not save the meeting link.");

        const { error: retryError } = await write();
        if (retryError !== null) throw new ResultsViewError("Could not save the meeting link.");
      }
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
        const path = `${fromRoundId}/proof-${Date.now()}-${sanitizeStorageFileName(proof.name)}`;
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
