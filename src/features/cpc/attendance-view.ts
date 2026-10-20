import { countAbsences } from "@domain/attendance";
import type { AttendanceStatus } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRoundsRepository } from "../central-cpc/rounds-repository";
import type { AttendanceView, ScheduledStudent } from "./attendance-page";

/**
 * PostgREST hands an embedded to-one row back as an object or as a one-item
 * array depending on the foreign-key hint used to reach it. The college name
 * is the same either way, and a missing row is no college rather than a
 * blank one invented for it.
 */
function embedded(value: unknown): Record<string, unknown> | null {
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
}

const embeddedName = (value: unknown): string | null =>
  (embedded(value)?.name as string | undefined) ?? null;

/**
 * Feeds the attendance screen.
 *
 * Prior absences are counted across the student's ENTIRE tenure (R8): there is
 * no per-drive reset, so the count must span every round they were ever
 * scheduled for, not just this drive.
 */
export function createSupabaseAttendanceView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<
    Parameters<typeof createSupabaseRoundsRepository>[2] extends () => Promise<infer R> ? R : never
  >,
): AttendanceView {
  const rounds = createSupabaseRoundsRepository(client, getActorId, getActorRole);

  return {
    async scheduled(roundId) {
      // Paged, and the error raised. A round at a big campus has more callers
      // than one select answers, and everyone past the thousandth simply was
      // not on the sheet — which on this screen is the same picture as a
      // student nobody called.
      const rows = await readAllRows((from, to) =>
        client
          .from("attendance")
          .select(
            "application_id, status, applications(student_id, profile_snapshot, students(full_name, roll_number, campuses(name)))",
          )
          .eq("round_id", roundId)
          .range(from, to),
      );

      const studentIds = [
        ...new Set(
          rows
            .map((row) => embedded(row.applications)?.student_id)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      ];

      /**
       * Whole-tenure history for the WHOLE roster in one grouped read: every
       * round these students were scheduled for, except this one. It used to
       * be a query per student — 900 round trips to draw one sheet, each of
       * them capped at a thousand rows of their own.
       */
      const historyRows = await readAllRowsByIds(
        studentIds,
        (batch) => (from, to) =>
          client
            .from("attendance")
            .select("status, round_id, applications!inner(student_id, drive_id)")
            .in("applications.student_id", batch)
            .neq("round_id", roundId)
            .range(from, to),
      );

      const historyByStudent = new Map<string, Array<Record<string, unknown>>>();
      for (const entry of historyRows) {
        const studentId = embedded(entry.applications)?.student_id;
        if (typeof studentId !== "string") continue;
        const list = historyByStudent.get(studentId) ?? [];
        list.push(entry);
        historyByStudent.set(studentId, list);
      }

      // R8 counts across the entire tenure; there is no per-drive reset.
      const priorAbsences = (studentId: string | null) =>
        countAbsences(
          (historyByStudent.get(studentId ?? "") ?? []).map((entry) => ({
            driveId: (embedded(entry.applications)?.drive_id as string | undefined) ?? "",
            roundId: entry.round_id as string,
            status: entry.status as AttendanceStatus,
          })),
        );

      return rows.map((row): ScheduledStudent => {
        const application = embedded(row.applications);
        const student = embedded(application?.students);
        const studentId = (application?.student_id as string | undefined) ?? null;

        return {
          applicationId: row.application_id as string,
          studentId,
          studentName: (student?.full_name as string | undefined) ?? "Unknown student",
          rollNumber: (student?.roll_number as string | undefined) ?? "—",
          college: embeddedName(student?.campuses),
          status: row.status as AttendanceStatus,
          priorAbsences: priorAbsences(studentId),
        };
      });
    },

    async mark(roundId, applicationId, status) {
      // Anyone in this list is by definition scheduled - the rows only exist
      // for scheduled participants.
      await rounds.markAttendance(roundId, applicationId, status, true);
    },

    async markBatch(roundId, entries) {
      await rounds.markBatchAttendance(roundId, entries, true);
    },
  };
}
