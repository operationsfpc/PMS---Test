import type { AttendanceRecord } from "@domain/attendance";
import { notificationCarriesOfferLetter } from "@domain/notifications";
import type { OfferCategory } from "@domain/offer-category";
import type { ApplicantRound } from "@domain/student-progress";
import type { AttendanceStatus, OfferSource, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseDrivesView } from "./drives-view";
import { offerLettersByDrive, signOfferLetters } from "./offer-letters";
import type {
  StudentApplicationRow,
  StudentDashboardSnapshot,
  StudentDashboardView,
  StudentOfferRow,
} from "./student-dashboard";

export class StudentDashboardError extends Error {}

/**
 * PostgREST returns an embedded to-one relation as an object, but the
 * generated types describe it as an array. Tolerate both.
 */
const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/** Numerics arrive from PostgREST as strings, and `8.40` must not become NaN. */
const num = (value: unknown): number => Number(value ?? 0);

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const DASHBOARD_STUDENT_COLUMNS = `
  id, full_name, roll_number, passing_year, srf_status, srf_rejection_reason,
  participation_status,
  degrees(name), branches(name), campuses(name),
  student_semesters(semester_number, cgpa, status)
`;

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const DASHBOARD_APPLICATION_COLUMNS = `
  id, applied_at,
  drives(id, company_name, role_title, drive_rounds(id, sequence, name))
`;

/**
 * One student's dashboard, from live rows.
 *
 * It gathers facts only. Where an application has got to, what the student
 * should do next, and whether their absences matter are all decided by
 * src/domain - see student-dashboard.tsx.
 *
 * The join that matters is the round one: `drive_rounds` says what rounds
 * exist, while `round_participants`, `round_results` and `attendance` say what
 * happened to THIS application. Keying those three by application id is what
 * stops one student being shown another's result.
 */
export function createSupabaseStudentDashboardView(
  client: SupabaseClient,
  getAuthUserId: () => Promise<string | null> = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): StudentDashboardView {
  // R5 decides which drives are open to THIS student. Counting live drives
  // instead would promise "3 drives are open to you" to someone eligible for
  // none of them, and the list they arrive at would be empty.
  const drivesView = createSupabaseDrivesView(client, getAuthUserId);

  return {
    async snapshot(): Promise<StudentDashboardSnapshot> {
      const userId = await getAuthUserId();
      if (userId === null) {
        throw new StudentDashboardError("Your session has expired. Please sign in again.");
      }

      const { data: student } = await client
        .from("students")
        .select(DASHBOARD_STUDENT_COLUMNS)
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (student === null || student === undefined) {
        throw new StudentDashboardError(
          "We could not find your student record. Contact your placement coordinator.",
        );
      }

      const studentId = student.id as string;

      const [{ data: applications }, { data: offers }, openDrives] = await Promise.all([
        client
          .from("applications")
          .select(DASHBOARD_APPLICATION_COLUMNS)
          .eq("student_id", studentId)
          .order("applied_at", { ascending: false }),
        client.from("offers").select(STUDENT_OFFER_COLUMNS).eq("student_id", studentId),
        drivesView.openDrives(),
      ]);

      const applicationRows = rows(applications);
      const applicationIds = applicationRows.map((a) => a.id as string);

      // RLS already limits these to this student, but filtering by their own
      // application ids keeps the query honest if a policy ever widens.
      const [{ data: participants }, { data: results }, { data: attendance }] =
        applicationIds.length === 0
          ? [{ data: [] }, { data: [] }, { data: [] }]
          : await Promise.all([
              client
                .from("round_participants")
                .select("round_id, application_id")
                .in("application_id", applicationIds),
              client
                .from("round_results")
                .select("round_id, application_id, result")
                .in("application_id", applicationIds),
              client
                .from("attendance")
                .select("round_id, application_id, status")
                .in("application_id", applicationIds),
            ]);

      const key = (applicationId: string, roundId: string) => `${applicationId}::${roundId}`;

      const sat = new Set(
        rows(participants).map((p) => key(p.application_id as string, p.round_id as string)),
      );
      const resultBy = new Map(
        rows(results).map((r) => [
          key(r.application_id as string, r.round_id as string),
          r.result as RoundResult,
        ]),
      );
      const attendanceBy = new Map(
        rows(attendance).map((a) => [
          key(a.application_id as string, a.round_id as string),
          a.status as AttendanceStatus,
        ]),
      );

      const offerRows = rows(offers);
      const wonDriveIds = new Set(
        offerRows.map((o) => o.drive_id).filter((id): id is string => typeof id === "string"),
      );
      const letters = await signOfferLetters(client, offerRows);

      const applicationList: StudentApplicationRow[] = applicationRows.map((row) => {
        const applicationId = row.id as string;
        const drive = one<Record<string, unknown>>(row.drives);

        const driveRounds: ApplicantRound[] = rows(drive?.drive_rounds)
          .map((round) => {
            const at = key(applicationId, round.id as string);
            return {
              sequence: Number(round.sequence),
              name: (round.name as string | null) ?? "Round",
              participating: sat.has(at),
              attendance: attendanceBy.get(at) ?? null,
              result: resultBy.get(at) ?? null,
            };
          })
          .sort((a, b) => a.sequence - b.sequence);

        return {
          applicationId,
          companyName: (drive?.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (drive?.role_title as string | null) ?? "Role not specified",
          appliedAt: row.applied_at as string,
          hasOffer: wonDriveIds.has((drive?.id as string | undefined) ?? ""),
          rounds: driveRounds,
        };
      });

      const attendanceRecords: AttendanceRecord[] = rows(attendance).map((a) => ({
        driveId: "",
        roundId: a.round_id as string,
        status: a.status as AttendanceStatus,
      }));

      return {
        fullName: student.full_name as string,
        rollNumber: student.roll_number as string,
        degree: one<{ name: string }>(student.degrees)?.name ?? "",
        branch: one<{ name: string }>(student.branches)?.name ?? "",
        passingYear: Number(student.passing_year),
        campus: one<{ name: string }>(student.campuses)?.name ?? "",
        srfStatus: student.srf_status as StudentDashboardSnapshot["srfStatus"],
        srfRejectionReason: (student.srf_rejection_reason as string | null) ?? null,
        participationStatus:
          student.participation_status as StudentDashboardSnapshot["participationStatus"],
        openDrives: openDrives.filter((drive) => drive.canApply).length,
        semesters: rows(student.student_semesters)
          .map((s) => ({
            semesterNumber: Number(s.semester_number),
            cgpa: num(s.cgpa),
            verified: s.status === "verified",
          }))
          .sort((a, b) => a.semesterNumber - b.semesterNumber),
        applications: applicationList,
        offers: offerRows.map((offer) => {
          const letter = letters.get(offer.id as string) ?? null;
          return {
            offerId: offer.id as string,
            driveId: (offer.drive_id as string | null) ?? null,
            companyName: (offer.company_name as string | null) ?? "Unnamed company",
            roleTitle: (offer.role_title as string | null) ?? null,
            driveType: (offer.drive_type as StudentOfferRow["driveType"]) ?? "placement",
            ctcLpa: (offer.ctc_lpa as number | null) === null ? null : num(offer.ctc_lpa),
            stipendMonthly: (offer.stipend_monthly as number | null) ?? null,
            offerCategory: (offer.offer_category as OfferCategory | null) ?? null,
            declaredAt: offer.declared_at as string,
            source: (offer.source as OfferSource | null) ?? "on_campus",
            // UAT 2026-08-27: the letter the CPC attached, which the student
            // could previously see nowhere at all.
            letterUrl: letter?.url ?? null,
            letterName: letter?.name ?? null,
          };
        }),
        attendance: attendanceRecords,
      };
    },

    /**
     * D8/D9 (2026-08-12): written by the database's triggers when the Central
     * CPC shortlists, records a result or declares an offer. RLS scopes the
     * read to the student's own rows.
     */
    async notifications() {
      const [{ data }, { data: offers }] = await Promise.all([
        client
          .from("notifications")
          .select(NOTIFICATION_COLUMNS)
          .order("created_at", { ascending: false }),
        // UAT 2026-08-27: the letter the message is about. Read here rather
        // than joined, because RLS already scopes both to this student and a
        // join would make one screen's failure the other's.
        client.from("offers").select(STUDENT_OFFER_COLUMNS),
      ]);

      const offerRows = rows(offers);
      const letterByDrive = offerLettersByDrive(
        offerRows,
        await signOfferLetters(client, offerRows),
      );

      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const driveId = (row.drive_id as string | null) ?? null;
        const kind = row.kind as string;
        // The domain decides WHICH message a letter belongs under — a placed
        // student still gets round schedules for the same drive.
        const letter =
          driveId !== null && notificationCarriesOfferLetter(kind)
            ? (letterByDrive.get(driveId) ?? null)
            : null;

        return {
          id: row.id as string,
          kind,
          title: row.title as string,
          body: row.body as string,
          createdAt: row.created_at as string,
          read: row.read_at !== null,
          driveId,
          letterUrl: letter?.url ?? null,
          letterName: letter?.name ?? null,
        };
      });
    },

    async markRead(notificationId) {
      await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .select("id");
    },
  };
}

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const NOTIFICATION_COLUMNS = "id, kind, title, body, created_at, read_at, drive_id";

/** Exported for the same reason — the offer columns a student may read. */
export const STUDENT_OFFER_COLUMNS =
  "id, drive_id, company_name, role_title, ctc_lpa, stipend_monthly, drive_type, offer_category, declared_at, source, attachment_path, attachment_name";
