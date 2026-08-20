import type { Offer } from "@domain/offers";
import { resolveDisplayedPlacement } from "@domain/offers";
import type { DriveType, ParticipationStatus, RoleCategory, SrfStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentRecord, StudentRecordView } from "./student-record-page";

/**
 * The canonical student record, read live (G7, UAT 2026-08-20).
 *
 * RLS decides whether the student row comes back at all — the Central CPC
 * reads everyone, a campus coordinator their campus, and nobody else reads
 * students. No role check is repeated here: a filter in the browser would be
 * a suggestion, and the database is the thing that actually refuses.
 *
 * The displayed placement is `resolveDisplayedPlacement` — the same rule the
 * directory uses (C1), so this page and the list it came from cannot disagree
 * about whether someone is placed.
 */

/** Supabase returns an embedded to-one either as an object or a one-element array. */
function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value ?? undefined) as T | undefined;
}

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/** Exported so src/db/query-contract.test.ts proves them against the schema. */
export const RECORD_STUDENT_COLUMNS = `
  id, full_name, roll_number, email, mobile, passing_year,
  srf_status, participation_status, tenth_percentage, twelfth_percentage,
  campuses(name), degrees(name), branches(name)
`;

export const RECORD_SEMESTER_COLUMNS = "semester_number, cgpa, status";
export const RECORD_SKILL_COLUMNS = "score, skill_areas(name)";
export const RECORD_APPLICATION_COLUMNS =
  "id, drive_id, applied_at, drives(company_name, role_title), shortlist_entries(included)";
export const RECORD_OFFER_COLUMNS =
  "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, declared_at, company_name, role_title";

export function createSupabaseStudentRecordView(client: SupabaseClient): StudentRecordView {
  return {
    async record(studentId): Promise<StudentRecord | null> {
      const { data: studentRows } = await client
        .from("students")
        .select(RECORD_STUDENT_COLUMNS)
        .eq("id", studentId)
        .limit(1);

      const student = rows(studentRows)[0];
      // Absent and refused deliberately look the same: telling a caller that
      // a row exists but is forbidden would leak the roster through the URL.
      if (student === undefined) return null;

      const [semesters, skills, preferences, applications, offers] = await Promise.all([
        client
          .from("student_semesters")
          .select(RECORD_SEMESTER_COLUMNS)
          .eq("student_id", studentId)
          .order("semester_number"),
        client
          .from("student_skill_scores")
          .select(RECORD_SKILL_COLUMNS)
          .eq("student_id", studentId),
        client.from("student_role_preferences").select("category").eq("student_id", studentId),
        client
          .from("applications")
          .select(RECORD_APPLICATION_COLUMNS)
          .eq("student_id", studentId)
          .order("applied_at", { ascending: false }),
        client.from("offers").select(RECORD_OFFER_COLUMNS).eq("student_id", studentId),
      ]);

      const offerRows = rows(offers.data);
      const parsedOffers: Offer[] = offerRows.map((row) => ({
        id: row.id as string,
        driveId: (row.drive_id as string | null) ?? "",
        driveType: row.drive_type as DriveType,
        offerCategory: (row.offer_category as Offer["offerCategory"]) ?? null,
        ctcLpa: Number(row.ctc_lpa ?? 0),
        declaredAt: new Date(row.declared_at as string),
        source: row.source as Offer["source"],
      }));

      const placementRecord = resolveDisplayedPlacement(parsedOffers);

      const applicationRows = rows(applications.data);
      const driveNames = new Map(
        applicationRows.map((row) => {
          const drive = one<{ company_name?: string | null; role_title?: string | null }>(
            row.drives,
          );
          return [
            row.drive_id as string,
            {
              companyName: drive?.company_name ?? "Company not recorded",
              roleTitle: drive?.role_title ?? null,
            },
          ];
        }),
      );

      const offeredDrives = new Set(
        offerRows.map((row) => row.drive_id as string | null).filter((id) => id !== null),
      );

      const placementOfferRow =
        placementRecord === null
          ? undefined
          : offerRows.find((row) => (row.id as string) === placementRecord.id);
      const placementDrive =
        placementRecord === null ? undefined : driveNames.get(placementRecord.driveId);

      return {
        studentId: student.id as string,
        fullName: (student.full_name as string | null) ?? "Unnamed student",
        rollNumber: (student.roll_number as string | null) ?? "",
        email: (student.email as string | null) ?? "",
        mobile: (student.mobile as string | null) ?? null,
        campusName: one<{ name?: string }>(student.campuses)?.name ?? "Unassigned campus",
        degree: one<{ name?: string }>(student.degrees)?.name ?? "",
        branch: one<{ name?: string }>(student.branches)?.name ?? "",
        passingYear: Number(student.passing_year ?? 0),
        srfStatus: student.srf_status as SrfStatus,
        participationStatus: student.participation_status as ParticipationStatus,
        tenthPercentage: student.tenth_percentage == null ? null : Number(student.tenth_percentage),
        twelfthPercentage:
          student.twelfth_percentage == null ? null : Number(student.twelfth_percentage),
        semesters: rows(semesters.data).map((row) => ({
          semesterNumber: Number(row.semester_number),
          cgpa: Number(row.cgpa),
          verified: row.status === "verified",
        })),
        skills: rows(skills.data).map((row) => ({
          skill: one<{ name?: string }>(row.skill_areas)?.name ?? "Unnamed skill",
          score: Number(row.score),
        })),
        rolePreferences: rows(preferences.data).map((row) => row.category as RoleCategory),
        applications: applicationRows.map((row) => {
          const drive = driveNames.get(row.drive_id as string);
          return {
            applicationId: row.id as string,
            driveId: row.drive_id as string,
            companyName: drive?.companyName ?? "Company not recorded",
            roleTitle: drive?.roleTitle ?? null,
            appliedAt: (row.applied_at as string | null) ?? null,
            shortlisted: rows(row.shortlist_entries).some((entry) => entry.included === true),
            hasOffer: offeredDrives.has(row.drive_id as string),
          };
        }),
        placement:
          placementRecord === null
            ? null
            : {
                companyName:
                  placementDrive?.companyName ??
                  (placementOfferRow?.company_name as string | null) ??
                  "Company not recorded",
                roleTitle:
                  placementDrive?.roleTitle ??
                  (placementOfferRow?.role_title as string | null) ??
                  null,
                ctcLpa: placementRecord.ctcLpa,
                offerCategory: placementRecord.offerCategory,
                source: placementRecord.source,
              },
      };
    },
  };
}
