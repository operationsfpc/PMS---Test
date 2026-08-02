import { countAbsences } from "@domain/attendance";
import type { AttendanceStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRoundsRepository } from "../central-cpc/rounds-repository";
import type { AttendanceView, ScheduledStudent } from "./attendance-page";

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
      const { data } = await client
        .from("attendance")
        .select(
          "application_id, status, applications(student_id, profile_snapshot, students(full_name, roll_number))",
        )
        .eq("round_id", roundId);

      const rows = (data ?? []) as Array<Record<string, unknown>>;

      return Promise.all(
        rows.map(async (row): Promise<ScheduledStudent> => {
          const application = row.applications as Record<string, unknown> | null;
          const student = (application?.students ?? null) as Record<string, unknown> | null;
          const studentId = application?.student_id as string | undefined;

          // Whole-tenure count: every round this student was scheduled for.
          const { data: history } = await client
            .from("attendance")
            .select("status, round_id, applications!inner(student_id, drive_id)")
            .eq("applications.student_id", studentId ?? "")
            .neq("round_id", roundId);

          return {
            applicationId: row.application_id as string,
            studentName: (student?.full_name as string | undefined) ?? "Unknown student",
            rollNumber: (student?.roll_number as string | undefined) ?? "—",
            status: row.status as AttendanceStatus,
            priorAbsences: countAbsences(
              (
                (history ?? []) as Array<{
                  status: string;
                  round_id: string;
                  applications: { drive_id?: string } | null;
                }>
              ).map((h) => ({
                driveId: h.applications?.drive_id ?? "",
                roundId: h.round_id,
                status: h.status as AttendanceStatus,
              })),
            ),
          };
        }),
      );
    },

    async mark(roundId, applicationId, status) {
      // Anyone in this list is by definition scheduled - the rows only exist
      // for scheduled participants.
      await rounds.markAttendance(roundId, applicationId, status, true);
    },
  };
}
