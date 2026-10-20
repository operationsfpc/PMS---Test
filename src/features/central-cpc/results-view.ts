import { completionReadiness } from "@domain/drive-completion";
import type { SlotAssignment } from "@domain/meeting-slots";
import type { RoundFacts } from "@domain/round-editing";
import { sanitizeStorageFileName } from "@domain/storage-path";
import { applicationProgress } from "@domain/student-progress";
import {
  type AppRole,
  type AttendanceStatus,
  DRIVE_STATUSES,
  type DriveStatus,
  type RoundResult,
} from "@domain/types";
import { readAll, readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
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

    /**
     * 2026-10-18: the drive's own lifecycle state. Read separately from the
     * rounds because a round row does not carry it, and the screen must ask
     * rather than assume — arriving by link is not evidence that a drive is
     * still open.
     */
    async driveStatus(driveId) {
      const { data, error } = await client
        .from("drives")
        .select("status")
        .eq("id", driveId)
        .maybeSingle();

      // `null` means "no status this rule knows", and the screen reads that as
      // permission to carry on. A refused read must not borrow that meaning:
      // it used to re-open the write buttons of a completed drive.
      if (error !== null) throw new ResultsViewError("Could not read this drive's state.");

      const status = (data as { status?: unknown } | null)?.status;
      // An unrecognised value is no status, not a guessed one: the screen
      // keeps the behaviour it had before this column was consulted.
      return DRIVE_STATUSES.includes(status as DriveStatus) ? (status as DriveStatus) : null;
    },

    /** F4 (UAT 2026-08-19): the round's details, edited after creation. */
    async updateRound(roundId, details) {
      const isVirtual = details.mode === "virtual";
      const isPhysical = details.mode === "on_campus" || details.mode === "physical_outside_campus";

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
      const { data: existing, error: existingError } = await client
        .from("drive_rounds")
        .select("sequence")
        .eq("drive_id", driveId)
        .order("sequence", { ascending: false })
        .limit(1);

      // Read without its error, a refusal looked like "there are no rounds",
      // and the insert that followed was aimed at sequence 1 — a collision the
      // coordinator was told was a problem with the round they had asked for.
      if (existingError !== null) {
        throw new ResultsViewError("Could not read this drive's rounds to number the new one.");
      }

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
      // Paged, because an uncapped dedupe list is the very bug above: read
      // only the first thousand already-scheduled, and somebody who IS in the
      // round counts as a newcomer, and the unique key refuses the batch again.
      let existing: Array<{ application_id: string }>;
      try {
        existing = await readAll<{ application_id: string }>((from, to) =>
          client
            .from("round_participants")
            .select("application_id")
            .eq("round_id", toRoundId)
            .range(from, to),
        );
      } catch {
        throw new ResultsViewError("Could not read who is already in the next round.");
      }
      const already = new Set(existing.map((row) => row.application_id as string));
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
    async removeRound(_driveId, roundId) {
      // 0099: a single function deletes and renumbers in one transaction, so
      // two coordinators removing rounds at the same time cannot produce
      // conflicting sequences.
      const { error } = await client.rpc("remove_drive_round", { p_round_id: roundId });
      if (error !== null) {
        throw new ResultsViewError(error.message || "Could not remove the round.");
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
      // Paged: a drive whose offers or applications pass a thousand used to
      // answer with the first thousand, and a student past that line was read
      // as still in the round — so their row stayed open after they were hired.
      const [offerRows, applicationRows] = await Promise.all([
        readAllRows((from, to) =>
          client.from("offers").select("student_id").eq("drive_id", driveId).range(from, to),
        ),
        readAllRows((from, to) =>
          client
            .from("applications")
            .select("id, student_id")
            .eq("drive_id", driveId)
            .range(from, to),
        ),
      ]);

      const offered = new Set(offerRows.map((o) => o.student_id as string));

      return new Set(
        applicationRows
          .filter((a) => offered.has(a.student_id as string))
          .map((a) => a.id as string),
      );
    },

    async completionFacts(driveId) {
      /*
       * The round relations used to be EMBEDDED, and PostgREST caps each
       * embedded collection at a thousand rows as well. On a drive whose first
       * round called 1,400 students, four hundred of them had no participant
       * row at all: their stage read as "applied", and the completion dialog
       * said a round that had run was waiting to be attended to. Flat reads,
       * paged and batched by round, exactly as /cpc/drives does it.
       */
      const [applicationRows, roundRows, offerRows] = await Promise.all([
        readAllRows((from, to) =>
          client
            .from("applications")
            .select("id, student_id")
            .eq("drive_id", driveId)
            .range(from, to),
        ),
        readAllRows((from, to) =>
          client
            .from("drive_rounds")
            .select("id, sequence, name")
            .eq("drive_id", driveId)
            .range(from, to),
        ),
        readAllRows((from, to) =>
          client.from("offers").select("student_id").eq("drive_id", driveId).range(from, to),
        ),
      ]);

      const roundIds = roundRows.map((r) => r.id as string);
      const [participantRows, resultRows, attendanceRows] = await Promise.all([
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("round_participants")
              .select("round_id, application_id")
              .in("round_id", batch)
              .range(from, to),
        ),
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("round_results")
              .select("round_id, application_id, result")
              .in("round_id", batch)
              .range(from, to),
        ),
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("attendance")
              .select("round_id, application_id, status")
              .in("round_id", batch)
              .range(from, to),
        ),
      ]);

      /**
       * Round → the three per-application facts, indexed once instead of
       * scanned for every applicant. An embedded read gave these as arrays hung
       * off the round; the flat rows carry `round_id`, so the round is the key.
       */
      interface RoundFactsByRound {
        participating: Set<string>;
        attendance: Map<string, AttendanceStatus>;
        result: Map<string, RoundResult>;
      }
      const byRound = new Map<string, RoundFactsByRound>();
      const factsFor = (roundId: string): RoundFactsByRound => {
        const existing = byRound.get(roundId);
        if (existing !== undefined) return existing;
        const created: RoundFactsByRound = {
          participating: new Set(),
          attendance: new Map(),
          result: new Map(),
        };
        byRound.set(roundId, created);
        return created;
      };
      for (const row of participantRows) {
        factsFor(row.round_id as string).participating.add(row.application_id as string);
      }
      for (const row of resultRows) {
        const facts = factsFor(row.round_id as string);
        const applicationId = row.application_id as string;
        if (!facts.result.has(applicationId)) {
          facts.result.set(applicationId, row.result as RoundResult);
        }
      }
      for (const row of attendanceRows) {
        const facts = factsFor(row.round_id as string);
        const applicationId = row.application_id as string;
        if (!facts.attendance.has(applicationId)) {
          facts.attendance.set(applicationId, row.status as AttendanceStatus);
        }
      }

      const offered = new Set(offerRows.map((o) => o.student_id as string));
      const orderedRounds = [...roundRows].sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      );

      const stages = applicationRows.map((application) => {
        const applicationId = application.id as string;
        const roundFacts = orderedRounds.map((round) => {
          const facts = byRound.get(round.id as string);
          return {
            sequence: Number(round.sequence ?? 0),
            name: String(round.name ?? "Round"),
            participating: facts?.participating.has(applicationId) ?? false,
            attendance: facts?.attendance.get(applicationId) ?? null,
            result: facts?.result.get(applicationId) ?? null,
          };
        });

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
      // Paged like the facts above: a round sheet that stopped at a thousand
      // rows silently left people off the list a coordinator was about to
      // mark absent.
      const [attendance, results, slots] = await Promise.all([
        readAllRows((from, to) =>
          client
            .from("attendance")
            .select(
              "application_id, status, applications(student_id, students(full_name, roll_number, campuses(name)))",
            )
            .eq("round_id", roundId)
            .range(from, to),
        ),
        readAllRows((from, to) =>
          client
            .from("round_results")
            .select("application_id, result")
            .eq("round_id", roundId)
            .range(from, to),
        ),
        readAllRows((from, to) =>
          client
            .from("round_participants")
            .select("application_id, meeting_link, participant_scheduled_at")
            .eq("round_id", roundId)
            .range(from, to),
        ),
      ]);

      const resultByApplication = new Map(
        results.map((r) => [r.application_id as string, r.result as RoundResult]),
      );
      const slotByApplication = new Map(
        slots.map((s) => [
          s.application_id as string,
          {
            meetingLink: (s.meeting_link as string | null) ?? null,
            scheduledAt: (s.participant_scheduled_at as string | null) ?? null,
          },
        ]),
      );

      const one = <T>(value: unknown): T | null =>
        (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

      return attendance
        .map((row): RoundParticipant => {
          const application = one<{ student_id?: string; students: unknown }>(row.applications);
          const student = one<{
            full_name?: string;
            roll_number?: string;
            campuses?: unknown;
          }>(application?.students);
          const slot = slotByApplication.get(row.application_id as string);

          return {
            applicationId: row.application_id as string,
            studentId: application?.student_id ?? null,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            college: one<{ name?: string }>(student?.campuses)?.name ?? null,
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
