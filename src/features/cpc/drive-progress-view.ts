import { isShortlisted } from "@domain/drive-funnel";
import type { AttendanceStatus, DriveType, RoundResult } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DriveProgressEntry,
  DriveProgressStudent,
  DriveProgressView,
  StudentRoundProgress,
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
  "drives(company_name, role_title, drive_type, status, company_drive_id, tentative_date)";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

export function createSupabaseDriveProgressView(client: SupabaseClient): DriveProgressView {
  return {
    async drives() {
      // The select string is assembled, which defeats supabase-js's type
      // parser; the shape is proven against the real schema by
      // query-contract.test.ts instead.
      const rows = await readAllRows((from, to) =>
        client.from("applications").select(PROGRESS_APPLICATION_COLUMNS).range(from, to),
      );
      if (rows.length === 0) return [];

      const driveIds = [...new Set(rows.map((r) => r.drive_id as string))];
      const applicationIds = rows.map((r) => r.id as string);
      const studentIds = [...new Set(rows.map((r) => r.student_id as string))];

      /**
       * Paged and id-batched. Each of these used to be one unpaged `.in()`
       * over every application at the campus: past a thousand rows the read
       * answered with the first thousand, and past a few hundred ids the URL
       * was refused outright — both came back as a table with rounds missing,
       * which reads exactly like a coordinator whose students did not attend.
       */
      const [roundRows, participantRows, attendanceRows, resultRows, offerRows] = await Promise.all(
        [
          readAllRowsByIds(
            driveIds,
            (batch) => (from, to) =>
              client
                .from("drive_rounds")
                .select("id, drive_id, sequence, name")
                .in("drive_id", batch)
                .range(from, to),
          ),
          readAllRowsByIds(
            applicationIds,
            (batch) => (from, to) =>
              client
                .from("round_participants")
                .select("round_id, application_id")
                .in("application_id", batch)
                .range(from, to),
          ),
          readAllRowsByIds(
            applicationIds,
            (batch) => (from, to) =>
              client
                .from("attendance")
                .select("round_id, application_id, status")
                .in("application_id", batch)
                .range(from, to),
          ),
          readAllRowsByIds(
            applicationIds,
            (batch) => (from, to) =>
              client
                .from("round_results")
                .select("round_id, application_id, result")
                .in("application_id", batch)
                .range(from, to),
          ),
          readAllRowsByIds(
            studentIds,
            (batch) => (from, to) =>
              client
                .from("offers")
                .select(
                  "student_id, drive_id, ctc_lpa, stipend_monthly, drive_type, offer_category",
                )
                .in("student_id", batch)
                .range(from, to),
          ),
        ],
      );

      const roundById = new Map(
        roundRows.map((r) => [
          r.id as string,
          {
            driveId: r.drive_id as string,
            sequence: Number(r.sequence),
            name: (r.name as string | null) ?? "Round",
          },
        ]),
      );
      const attendanceByKey = new Map(
        attendanceRows.map((a) => [
          `${a.round_id}:${a.application_id}`,
          a.status as AttendanceStatus,
        ]),
      );
      const resultByKey = new Map(
        resultRows.map((r) => [`${r.round_id}:${r.application_id}`, r.result as RoundResult]),
      );
      const offerByKey = new Map(
        offerRows.map((o) => [
          `${o.student_id}:${o.drive_id}`,
          {
            ctcLpa: (o.ctc_lpa as number | null) === null ? null : Number(o.ctc_lpa),
            stipendMonthly: (o.stipend_monthly as number | null) ?? null,
            driveType: (o.drive_type as DriveType | null) ?? "placement",
            offerCategory: (o.offer_category as string | null) ?? null,
          },
        ]),
      );

      // Which rounds each student was CALLED to — the fact the row list is
      // built from. Attendance is what happened after being called.
      const roundsByApplication = new Map<string, string[]>();
      for (const row of participantRows) {
        const appId = row.application_id as string;
        const list = roundsByApplication.get(appId) ?? [];
        list.push(row.round_id as string);
        roundsByApplication.set(appId, list);
      }

      const byDrive = new Map<string, DriveProgressEntry>();
      for (const row of rows) {
        const driveId = row.drive_id as string;
        const applicationId = row.id as string;
        const studentId = row.student_id as string;
        const drive = one<{
          company_name?: string;
          role_title?: string | null;
          drive_type?: string | null;
          status?: string;
          company_drive_id?: string | null;
          tentative_date?: string | null;
        }>(row.drives);
        const student = one<{ full_name?: string; roll_number?: string; campuses?: unknown }>(
          row.students,
        );
        const campusName = one<{ name?: string }>(student?.campuses)?.name;

        const studentRounds = (roundsByApplication.get(applicationId) ?? [])
          .map((roundId): StudentRoundProgress | null => {
            const round = roundById.get(roundId);
            if (round === undefined) return null;
            const key = `${roundId}:${applicationId}`;
            return {
              sequence: round.sequence,
              name: round.name,
              // No attendance row is not an absence: the round has simply not
              // been marked for them yet. Recording one would hand the student
              // to the R8 disbarment count for nothing.
              attendance: attendanceByKey.get(key) ?? "scheduled",
              result: resultByKey.get(key) ?? null,
            };
          })
          .filter((r): r is StudentRoundProgress => r !== null)
          .sort((a, b) => a.sequence - b.sequence);

        const entry: DriveProgressStudent = {
          applicationId,
          // The popup under a count names people and links to their record,
          // so the read that produced the row has to carry who it belongs to.
          studentId,
          studentName: student?.full_name ?? "Unknown student",
          rollNumber: student?.roll_number ?? "—",
          campusName,
          // Every shortlist row, not the first: a student the coordinator
          // re-included after a withdrawal is not decided by whichever row
          // PostgREST happened to embed first.
          shortlisted: isShortlisted(
            (Array.isArray(row.shortlist_entries) ? row.shortlist_entries : []).map((entry) => ({
              included: (entry as { included?: boolean | null }).included ?? null,
            })),
          ),
          rounds: studentRounds,
          offer: offerByKey.get(`${studentId}:${driveId}`) ?? null,
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
            companyDriveId: drive?.company_drive_id ?? null,
            tentativeDate: drive?.tentative_date ?? null,
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
