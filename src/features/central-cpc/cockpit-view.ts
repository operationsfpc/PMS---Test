import { countAbsences, needsDisbarmentReview } from "@domain/attendance";
import type { AttendanceStatus, DriveStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CockpitView, DisbarmentReview, DriveSummary } from "./cockpit-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Feeds the cockpit.
 *
 * Application counts come from a head-count query rather than by pulling every
 * row: the cockpit needs the number, not the applicants.
 */
export function createSupabaseCockpitView(client: SupabaseClient): CockpitView {
  return {
    async drives() {
      const { data: drives } = await client
        .from("drives")
        .select(
          "id, company_name, role_title, ctc_min_lpa, ctc_max_lpa, status, on_hold, created_at, application_end, drive_rounds(id, sequence, name)",
        )
        .order("created_at", { ascending: false });

      const rows = (drives ?? []) as Array<Record<string, unknown>>;

      return Promise.all(
        rows.map(async (row): Promise<DriveSummary> => {
          const { count } = await client
            .from("applications")
            .select("id", { count: "exact", head: true })
            .eq("drive_id", row.id as string);

          const rounds = (Array.isArray(row.drive_rounds) ? row.drive_rounds : []) as Array<
            Record<string, unknown>
          >;

          return {
            driveId: row.id as string,
            companyName: (row.company_name as string | null) ?? "Unnamed drive",
            roleTitle: (row.role_title as string | null) ?? null,
            // Numerics arrive from PostgREST as strings.
            ctcMinLpa: row.ctc_min_lpa == null ? null : Number(row.ctc_min_lpa),
            ctcMaxLpa: row.ctc_max_lpa == null ? null : Number(row.ctc_max_lpa),
            status: (row.status as DriveStatus | null) ?? "draft",
            onHold: (row.on_hold as boolean | null) ?? false,
            applicationCount: count ?? 0,
            // G1a/G1d (UAT 2026-08-20): the card's age and its deadline.
            createdAt: (row.created_at as string | null) ?? null,
            applicationEnd: (row.application_end as string | null) ?? null,
            rounds: rounds
              .map((r) => ({
                roundId: r.id as string,
                sequence: r.sequence as number,
                name: (r.name as string | null) ?? "Round",
              }))
              .sort((a, b) => a.sequence - b.sequence),
          };
        }),
      );
    },

    /**
     * R8: absences are counted across the student's ENTIRE tenure, with no
     * per-drive reset, and the threshold raises a review rather than a
     * sanction. Both decisions belong to the domain, not to this query.
     */
    async reviews() {
      const { data } = await client
        .from("attendance")
        .select(
          "status, round_id, applications(student_id, drive_id, students(full_name, roll_number))",
        )
        .eq("status", "absent");

      const byStudent = new Map<
        string,
        {
          name: string;
          roll: string;
          records: { driveId: string; roundId: string; status: AttendanceStatus }[];
        }
      >();

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const application = one<{ student_id?: string; drive_id?: string; students: unknown }>(
          row.applications,
        );
        const student = one<{ full_name?: string; roll_number?: string }>(application?.students);
        const studentId = application?.student_id;
        if (studentId === undefined) continue;

        const entry = byStudent.get(studentId) ?? {
          name: student?.full_name ?? "Unknown student",
          roll: student?.roll_number ?? "—",
          records: [],
        };
        entry.records.push({
          driveId: application?.drive_id ?? "",
          roundId: row.round_id as string,
          status: row.status as AttendanceStatus,
        });
        byStudent.set(studentId, entry);
      }

      const reviews: DisbarmentReview[] = [];
      for (const [studentId, entry] of byStudent) {
        const absences = countAbsences(entry.records);
        if (!needsDisbarmentReview(absences)) continue;
        reviews.push({
          studentId,
          studentName: entry.name,
          rollNumber: entry.roll,
          absences,
        });
      }

      return reviews.sort((a, b) => b.absences - a.absences);
    },
  };
}
