import type { AttendanceStatus, DriveType, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DriveProgressEntry,
  DriveProgressStudent,
  DriveProgressView,
} from "./drive-progress-page";

/**
 * Feeds the campus coordinator's drive-progress screen (D10, 2026-08-12).
 *
 * Everything is scoped by RLS: applications, attendance, results and offers
 * come back only for the coordinator's own campus (0018, 0043), and drives
 * are readable since 0044. No query here filters by campus — the database
 * does, which is the only filter that cannot be forgotten.
 */

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const PROGRESS_APPLICATION_COLUMNS =
  "id, student_id, drive_id, students(full_name, roll_number, campuses(name)), shortlist_entries(included), " +
  "drives(company_name, role_title, drive_type, status)";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

export function createSupabaseDriveProgressView(client: SupabaseClient): DriveProgressView {
  return {
    async drives() {
      const { data: applications } = await client
        .from("applications")
        .select(PROGRESS_APPLICATION_COLUMNS);

      // The select string is assembled, which defeats supabase-js's type
      // parser; the shape is proven against the real schema by
      // query-contract.test.ts instead.
      const rows = (applications ?? []) as unknown as Array<Record<string, unknown>>;
      if (rows.length === 0) return [];

      const driveIds = [...new Set(rows.map((r) => r.drive_id as string))];
      const applicationIds = rows.map((r) => r.id as string);
      const studentIds = [...new Set(rows.map((r) => r.student_id as string))];

      const [{ data: rounds }, { data: attendance }, { data: results }, { data: offers }] =
        await Promise.all([
          client
            .from("drive_rounds")
            .select("id, drive_id, sequence, name")
            .in("drive_id", driveIds),
          client
            .from("attendance")
            .select("round_id, application_id, status")
            .in("application_id", applicationIds),
          client
            .from("round_results")
            .select("round_id, application_id, result")
            .in("application_id", applicationIds),
          client
            .from("offers")
            .select("student_id, drive_id, ctc_lpa, stipend_monthly, drive_type, offer_category")
            .in("student_id", studentIds),
        ]);

      const roundById = new Map(
        ((rounds ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          { driveId: r.drive_id as string, sequence: Number(r.sequence), name: String(r.name) },
        ]),
      );
      const resultByKey = new Map(
        ((results ?? []) as Array<Record<string, unknown>>).map((r) => [
          `${r.round_id}:${r.application_id}`,
          r.result as RoundResult,
        ]),
      );
      const offerByKey = new Map(
        ((offers ?? []) as Array<Record<string, unknown>>).map((o) => [
          `${o.student_id}:${o.drive_id}`,
          {
            ctcLpa: (o.ctc_lpa as number | null) === null ? null : Number(o.ctc_lpa),
            stipendMonthly: (o.stipend_monthly as number | null) ?? null,
            driveType: (o.drive_type as DriveType | null) ?? "placement",
            offerCategory: (o.offer_category as string | null) ?? null,
          },
        ]),
      );

      const attendanceByApplication = new Map<string, Array<Record<string, unknown>>>();
      for (const row of (attendance ?? []) as Array<Record<string, unknown>>) {
        const list = attendanceByApplication.get(row.application_id as string) ?? [];
        list.push(row);
        attendanceByApplication.set(row.application_id as string, list);
      }

      const byDrive = new Map<string, DriveProgressEntry>();
      for (const row of rows) {
        const driveId = row.drive_id as string;
        const drive = one<{
          company_name?: string;
          role_title?: string | null;
          drive_type?: string | null;
          status?: string;
        }>(row.drives);
        const student = one<{ full_name?: string; roll_number?: string; campuses?: unknown }>(
          row.students,
        );
        const campusName = one<{ name?: string }>(student?.campuses)?.name;

        const studentRounds = (attendanceByApplication.get(row.id as string) ?? [])
          .map((att) => {
            const round = roundById.get(att.round_id as string);
            if (round === undefined) return null;
            return {
              sequence: round.sequence,
              name: round.name,
              attendance: att.status as AttendanceStatus,
              result: resultByKey.get(`${att.round_id}:${row.id}`) ?? null,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => a.sequence - b.sequence);

        const entry: DriveProgressStudent = {
          applicationId: row.id as string,
          studentName: student?.full_name ?? "Unknown student",
          rollNumber: student?.roll_number ?? "—",
          campusName,
          shortlisted: one<{ included?: boolean }>(row.shortlist_entries)?.included === true,
          rounds: studentRounds,
          offer: offerByKey.get(`${row.student_id}:${driveId}`) ?? null,
        };

        const existing = byDrive.get(driveId);
        if (existing === undefined) {
          byDrive.set(driveId, {
            driveId,
            companyName: drive?.company_name ?? "Unknown company",
            roleTitle: drive?.role_title ?? null,
            // 2026-08-27: filtered on, and tagged on every card.
            driveType: (drive?.drive_type as DriveType | null) ?? null,
            status: drive?.status ?? "live",
            students: [entry],
          });
        } else {
          byDrive.set(driveId, { ...existing, students: [...existing.students, entry] });
        }
      }

      return [...byDrive.values()]
        .map((drive) => ({
          ...drive,
          students: [...drive.students].sort((a, b) => a.studentName.localeCompare(b.studentName)),
        }))
        .sort((a, b) => a.companyName.localeCompare(b.companyName));
    },
  };
}
