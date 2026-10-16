import { countAbsences, needsDisbarmentReview } from "@domain/attendance";
import type { AttendanceStatus, DriveStatus, DriveType } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CockpitView, DisbarmentReview, DriveSummary } from "./cockpit-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real
 * schema — a select that drifts from the columns cannot hide in unit tests.
 */
export const COCKPIT_DRIVE_COLUMNS = `
  id, company_name, role_title, ctc_min_lpa, ctc_max_lpa, stipend_min_monthly, stipend_max_monthly,
  drive_type, status, on_hold, created_at, application_end, drive_mode, venue, company_drive_id,
  tentative_date, drive_rounds(id, sequence, name), drive_target_campuses(campuses(name))
`;

/**
 * Feeds the cockpit.
 *
 * One read of `applications(drive_id, student_id)` covers every drive's
 * applicants. It replaces a `count: "exact"` head query issued once per drive
 * — that was a round trip per card and, worse, an answer that could only ever
 * be a number: the count on a card opens a list of WHO applied.
 */
export function createSupabaseCockpitView(client: SupabaseClient): CockpitView {
  return {
    async drives() {
      const rows = await readAllRows((from, to) =>
        client
          .from("drives")
          .select(COCKPIT_DRIVE_COLUMNS)
          .order("created_at", { ascending: false })
          .range(from, to),
      );

      const byDrive = new Map<string, string[]>();
      const applications = await readAllRowsByIds(
        rows.map((row) => row.id as string),
        (batch) => (from, to) =>
          client
            .from("applications")
            .select("drive_id, student_id")
            .in("drive_id", batch)
            .range(from, to),
      );
      for (const application of applications) {
        const driveId = application.drive_id as string;
        const ids = byDrive.get(driveId) ?? [];
        ids.push(application.student_id as string);
        byDrive.set(driveId, ids);
      }

      return rows.map((row): DriveSummary => {
        const rounds = (Array.isArray(row.drive_rounds) ? row.drive_rounds : []) as Array<
          Record<string, unknown>
        >;
        const applicantStudentIds = byDrive.get(row.id as string) ?? [];

        return {
          driveId: row.id as string,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? null,
          // Numerics arrive from PostgREST as strings.
          ctcMinLpa: row.ctc_min_lpa == null ? null : Number(row.ctc_min_lpa),
          ctcMaxLpa: row.ctc_max_lpa == null ? null : Number(row.ctc_max_lpa),
          // 2026-08-27: an internship pays a stipend and has no CTC, and
          // the Delivery Head approves from this list too (G1c).
          stipendMinMonthly:
            row.stipend_min_monthly == null ? null : Number(row.stipend_min_monthly),
          stipendMaxMonthly:
            row.stipend_max_monthly == null ? null : Number(row.stipend_max_monthly),
          driveType: (row.drive_type as DriveType | null) ?? null,
          status: (row.status as DriveStatus | null) ?? "draft",
          onHold: (row.on_hold as boolean | null) ?? false,
          applicationCount: applicantStudentIds.length,
          applicantStudentIds,
          // G1a/G1d (UAT 2026-08-20): the card's age and its deadline.
          createdAt: (row.created_at as string | null) ?? null,
          applicationEnd: (row.application_end as string | null) ?? null,
          // UAT 2026-08-21 item 2: the off-campus venue, if the mode has one.
          driveMode: (row.drive_mode as string | null) ?? null,
          venue: (row.venue as string | null) ?? null,
          companyDriveId: (row.company_drive_id as string | null) ?? null,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          campuses: (
            (Array.isArray(row.drive_target_campuses) ? row.drive_target_campuses : []) as Array<{
              campuses?: { name?: string } | null;
            }>
          )
            .map((tc) => tc.campuses?.name)
            .filter((name): name is string => typeof name === "string" && name !== ""),
          rounds: rounds
            .map((r) => ({
              roundId: r.id as string,
              sequence: r.sequence as number,
              name: (r.name as string | null) ?? "Round",
            }))
            .sort((a, b) => a.sequence - b.sequence),
        };
      });
    },

    /**
     * UAT 2026-08-21 item 2: the Central CPC records the venue the company
     * finally confirmed. A plain UPDATE — RLS (drives_operator_update) and
     * the audit trigger do the enforcement and the remembering.
     */
    async updateVenue(driveId: string, venue: string) {
      const { error } = await client.from("drives").update({ venue }).eq("id", driveId);
      if (error !== null) {
        throw new Error("Could not save the venue. Check your access and try again.");
      }
    },

    /**
     * R8: absences are counted across the student's ENTIRE tenure, with no
     * per-drive reset, and the threshold raises a review rather than a
     * sanction. Both decisions belong to the domain, not to this query.
     */
    async reviews() {
      const data = await readAllRows((from, to) =>
        client
          .from("attendance")
          .select(
            "status, round_id, applications(student_id, drive_id, students(full_name, roll_number))",
          )
          .eq("status", "absent")
          .range(from, to),
      );

      const byStudent = new Map<
        string,
        {
          name: string;
          roll: string;
          records: { driveId: string; roundId: string; status: AttendanceStatus }[];
        }
      >();

      for (const row of data) {
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
