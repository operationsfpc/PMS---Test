import type { Offer } from "@domain/offers";
import { resolveDisplayedPlacement } from "@domain/offers";
import type { DirectoryStudent } from "@domain/student-directory";
import type { DriveType, ParticipationStatus, SrfStatus } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import { signedResumeLinks } from "@lib/resume-links";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentDirectoryView } from "./students-page";

/**
 * The student directory, read live.
 *
 * RLS decides which students come back, so this same view serves a Central CPC
 * (everyone) and a campus coordinator (their campus). There is no role check
 * here on purpose: a filter in the browser would be a suggestion, and the
 * database is the thing that actually refuses.
 *
 * The placement shown is R9's - `resolvePlacementRecord`, the same function
 * the dashboard uses. A student holding three offers appears once, at the one
 * that is their record, and the count on the overview matches the rows here
 * because both ask the same function.
 */

/** Supabase returns an embedded to-one either as an object or a one-element array. */
function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value ?? undefined) as T | undefined;
}

const STUDENT_COLUMNS = `
  id,
  full_name,
  roll_number,
  passing_year,
  overall_cgpa,
  srf_status,
  participation_status,
  campuses ( name ),
  degrees ( name ),
  branches ( name )
`;

export function createSupabaseStudentDirectoryView(client: SupabaseClient): StudentDirectoryView {
  return {
    /**
     * #79 (UAT 2026-10-18): the CSV a coordinator hands to a recruiter or keeps
     * as the academic record is worth one column more — the CV itself.
     *
     * Keyed by STUDENT, because that is what a directory row is. A student may
     * hold one resume PER ROLE CATEGORY (0003's `one_resume_per_category`), so
     * the link is the one they uploaded last: the file they would send today.
     */
    async resumeLinks(studentIds) {
      if (studentIds.length === 0) return new Map();

      const rows = await readAllRowsByIds(
        studentIds,
        (batch) => (from, to) =>
          client
            .from("student_documents")
            .select("student_id, storage_path, uploaded_at")
            .eq("kind", "resume")
            .in("student_id", batch)
            .order("uploaded_at")
            .range(from, to),
      );

      const latestByStudent = new Map<string, string>();
      for (const row of rows as Array<{ student_id: string; storage_path: string }>) {
        // Ascending by upload time, so the last one written IS the newest.
        latestByStudent.set(row.student_id as string, row.storage_path as string);
      }

      return signedResumeLinks(
        client,
        [...latestByStudent].map(([studentId, storagePath]) => ({ key: studentId, storagePath })),
      );
    },

    async students(): Promise<readonly DirectoryStudent[]> {
      /*
       * Paged, and every read failure raised. 2026-10-18 (UAT: "read all the
       * page of all logins"): this asked for the roster once, so an organisation
       * of six thousand students got the first thousand and the directory, its
       * filters and its CSV answered for those thousand only. The offers and
       * applications then went in by one `in=(...)` list of every id, which is a
       * URL long enough for the gateway to refuse — and a refused list comes
       * back empty rather than as an error, so a placed student was rendered as
       * an unplaced one.
       */
      const rows = await readAllRows((from, to) =>
        client.from("students").select(STUDENT_COLUMNS).order("full_name").range(from, to),
      );

      const studentIds = rows.map((r) => r.id as string);
      if (studentIds.length === 0) return [];

      const [offerRows, applicationRows] = await Promise.all([
        readAllRowsByIds(
          studentIds,
          (batch) => (from, to) =>
            client
              .from("offers")
              .select(
                // company_name and role_title live on the OFFER for a self-placed
                // one (drive_id is null there) — C1's Thanush had both and the
                // view never asked for them.
                "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, stipend_monthly, declared_at, company_name, role_title",
              )
              .in("student_id", batch)
              .range(from, to),
        ),
        readAllRowsByIds(
          studentIds,
          (batch) => (from, to) =>
            client
              .from("applications")
              .select("id, student_id")
              .in("student_id", batch)
              .range(from, to),
        ),
      ]);

      // The company and role live on the drive, not on the offer, so the
      // offers have to be resolved before they can be named.
      const driveIds = [
        ...new Set(
          offerRows
            .map((o) => o.drive_id as string | null)
            .filter((id): id is string => id !== null),
        ),
      ];

      const driveRows = await readAllRowsByIds(
        driveIds,
        (batch) => (from, to) =>
          client
            .from("drives")
            .select("id, company_name, role_title")
            .in("id", batch)
            .range(from, to),
      );

      const drives = new Map(
        driveRows.map((d) => [
          d.id as string,
          {
            companyName: (d.company_name as string | null) ?? "Company not recorded",
            roleTitle: (d.role_title as string | null) ?? null,
          },
        ]),
      );

      const offersByStudent = new Map<string, Offer[]>();
      // What the offer row itself says about the company — the only naming a
      // self-placed offer has.
      const offerNames = new Map<
        string,
        { companyName: string | null; roleTitle: string | null }
      >();
      for (const row of offerRows) {
        const studentId = row.student_id as string;
        const forStudent = offersByStudent.get(studentId) ?? [];
        forStudent.push({
          id: row.id as string,
          driveId: (row.drive_id as string | null) ?? "",
          driveType: row.drive_type as DriveType,
          offerCategory: (row.offer_category as Offer["offerCategory"]) ?? null,
          ctcLpa: Number(row.ctc_lpa ?? 0),
          declaredAt: new Date(row.declared_at as string),
          source: row.source as Offer["source"],
        });
        offersByStudent.set(studentId, forStudent);
        offerNames.set(row.id as string, {
          companyName: (row.company_name as string | null) ?? null,
          roleTitle: (row.role_title as string | null) ?? null,
        });
      }

      const applicationCounts = new Map<string, number>();
      for (const row of applicationRows) {
        const studentId = row.student_id as string;
        applicationCounts.set(studentId, (applicationCounts.get(studentId) ?? 0) + 1);
      }

      return rows.map((row): DirectoryStudent => {
        const studentId = row.id as string;
        const offers = offersByStudent.get(studentId) ?? [];
        // C1: the DISPLAYED placement, which a self-placed offer satisfies —
        // not R9's reported record, which excludes them by design.
        const record = resolveDisplayedPlacement(offers);
        const drive = record === null ? undefined : drives.get(record.driveId);
        const named = record === null ? undefined : offerNames.get(record.id);

        return {
          studentId,
          fullName: (row.full_name as string | null) ?? "Unnamed student",
          rollNumber: (row.roll_number as string | null) ?? "",
          campusName: one<{ name?: string }>(row.campuses)?.name ?? "Unassigned campus",
          degree: one<{ name?: string }>(row.degrees)?.name ?? "",
          branch: one<{ name?: string }>(row.branches)?.name ?? "",
          passingYear: Number(row.passing_year ?? 0),
          cgpa:
            row.overall_cgpa === null || row.overall_cgpa === undefined
              ? null
              : Number(row.overall_cgpa),
          srfStatus: row.srf_status as SrfStatus,
          participationStatus: row.participation_status as ParticipationStatus,
          applications: applicationCounts.get(studentId) ?? 0,
          // Its own fact, not read off the displayed row: an on-campus record
          // wins the display (C1), and the Self-placed card on the overview
          // still counts this student. Reading the source of `placement`
          // instead would lose them from the list that card opens.
          hasSelfPlacement: offers.some((o) => o.source === "self_placed"),
          placement:
            record === null
              ? null
              : {
                  companyName: drive?.companyName ?? named?.companyName ?? "Company not recorded",
                  roleTitle: drive?.roleTitle ?? named?.roleTitle ?? null,
                  ctcLpa: record.ctcLpa,
                  offerCategory: record.offerCategory,
                  source: record.source,
                },
        };
      });
    },
  };
}
