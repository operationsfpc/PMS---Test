import type { SchoolBoard } from "@domain/boards";
import type { OfferCategory } from "@domain/offer-category";
import type { Offer } from "@domain/offers";
import { resolveDisplayedPlacement } from "@domain/offers";
import {
  extractOriginalFilename,
  objectKeyIn,
  sanitizeStorageFileName,
} from "@domain/storage-path";
import type {
  DriveType,
  OfferSource,
  ParticipationStatus,
  RoleCategory,
  SrfStatus,
} from "@domain/types";
import { readAllRows } from "@lib/postgrest-read";
import { signedResumeLinks } from "@lib/resume-links";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StudentRecord,
  StudentRecordOffer,
  StudentRecordResume,
  StudentRecordView,
} from "./student-record-page";

export class StudentRecordError extends Error {}

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
  id, full_name, roll_number, email, mobile, whatsapp, alternate_contact, passing_year,
  srf_status, participation_status, tenth_percentage, twelfth_percentage,
  tenth_institution, tenth_board, twelfth_institution, twelfth_board,
  diploma_institution, diploma_marks,
  overall_cgpa, current_arrears, history_of_arrears,
  drive_type_preferences,
  technical_skills, areas_of_interest, areas_of_expertise,
  projects, certifications, achievements,
  linkedin_url, github_url, leetcode_url, hackerrank_url,
  campuses(name), degrees(name), branches(name)
`;

export const RECORD_SEMESTER_COLUMNS = "semester_number, cgpa, status";
export const RECORD_SKILL_COLUMNS = "score, skill_areas(name)";
export const RECORD_APPLICATION_COLUMNS =
  "id, drive_id, applied_at, drives(company_name, role_title), shortlist_entries(included)";
export const RECORD_OFFER_COLUMNS =
  "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, stipend_monthly, declared_at, company_name, role_title, attachment_path, attachment_name";
export const RECORD_DOCUMENT_COLUMNS =
  "id, kind, role_category, storage_path, size_bytes, uploaded_at";

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

      let semesterRows: Array<Record<string, unknown>>;
      let skillRows: Array<Record<string, unknown>>;
      let preferenceRows: Array<Record<string, unknown>>;
      let applicationRows: Array<Record<string, unknown>>;
      let offerRows: Array<Record<string, unknown>>;
      let documentRows: Array<Record<string, unknown>>;
      try {
        [semesterRows, skillRows, preferenceRows, applicationRows, offerRows, documentRows] =
          await Promise.all([
            readAllRows((from, to) =>
              client
                .from("student_semesters")
                .select(RECORD_SEMESTER_COLUMNS)
                .eq("student_id", studentId)
                .order("semester_number")
                .range(from, to),
            ),
            readAllRows((from, to) =>
              client
                .from("student_skill_scores")
                .select(RECORD_SKILL_COLUMNS)
                .eq("student_id", studentId)
                .range(from, to),
            ),
            readAllRows((from, to) =>
              client
                .from("student_role_preferences")
                .select("category")
                .eq("student_id", studentId)
                .range(from, to),
            ),
            readAllRows((from, to) =>
              client
                .from("applications")
                .select(RECORD_APPLICATION_COLUMNS)
                .eq("student_id", studentId)
                .order("applied_at", { ascending: false })
                .range(from, to),
            ),
            readAllRows((from, to) =>
              client
                .from("offers")
                .select(RECORD_OFFER_COLUMNS)
                .eq("student_id", studentId)
                .range(from, to),
            ),
            readAllRows((from, to) =>
              client
                .from("student_documents")
                .select(RECORD_DOCUMENT_COLUMNS)
                .eq("student_id", studentId)
                .eq("kind", "resume")
                .range(from, to),
            ),
          ]);
      } catch {
        // An empty list is a fact about this student; a refused read is not.
        // Read past, a failed skills query rendered "No skill scores
        // recorded." and a failed offers query rendered "Not placed."
        throw new StudentRecordError(
          "Could not read this student's full record. Please try again.",
        );
      }

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

      // Sign offer letters if attached
      const allOffers: StudentRecordOffer[] = await Promise.all(
        offerRows.map(async (row) => {
          const drive = row.drive_id ? driveNames.get(row.drive_id as string) : undefined;
          const attachmentPath = row.attachment_path as string | null;
          let letterUrl: string | null = null;
          if (attachmentPath) {
            try {
              const { data: signed } = await client.storage
                .from("offer-letters")
                .createSignedUrl(objectKeyIn("offer-letters", attachmentPath), 600);
              letterUrl = signed?.signedUrl ?? null;
            } catch {
              letterUrl = null;
            }
          }
          return {
            id: row.id as string,
            driveId: (row.drive_id as string | null) ?? null,
            companyName:
              drive?.companyName ?? (row.company_name as string | null) ?? "Company not recorded",
            roleTitle: drive?.roleTitle ?? (row.role_title as string | null) ?? null,
            driveType: row.drive_type as DriveType,
            offerCategory: (row.offer_category as OfferCategory | null) ?? null,
            ctcLpa: row.ctc_lpa != null ? Number(row.ctc_lpa) : null,
            stipendMonthly: row.stipend_monthly != null ? Number(row.stipend_monthly) : null,
            declaredAt: (row.declared_at as string | null) ?? new Date().toISOString(),
            source: row.source as OfferSource,
            letterUrl,
            letterFileName:
              (row.attachment_name as string | null) ??
              (attachmentPath ? extractOriginalFilename(attachmentPath) : null),
          };
        }),
      );

      // Sign resumes
      const resumeFiles = documentRows
        .filter((row) => row.storage_path)
        .map((row) => ({
          key: row.id as string,
          storagePath: row.storage_path as string,
        }));

      let signedResumeMap = new Map<string, string>();
      if (resumeFiles.length > 0) {
        try {
          signedResumeMap = await signedResumeLinks(client, resumeFiles, 600);
        } catch {
          // If signing fails, resume cards still list the file
        }
      }

      const resumes: StudentRecordResume[] = documentRows.map((row) => {
        const path = row.storage_path as string;
        return {
          id: row.id as string,
          roleCategory: row.role_category as RoleCategory,
          storagePath: path,
          fileName: extractOriginalFilename(path) ?? "resume.pdf",
          sizeBytes: Number(row.size_bytes ?? 0),
          uploadedAt: (row.uploaded_at as string | null) ?? new Date().toISOString(),
          downloadUrl: signedResumeMap.get(row.id as string) ?? null,
        };
      });

      return {
        studentId: student.id as string,
        fullName: (student.full_name as string | null) ?? "Unnamed student",
        rollNumber: (student.roll_number as string | null) ?? "",
        email: (student.email as string | null) ?? "",
        mobile: (student.mobile as string | null) ?? null,
        whatsapp: (student.whatsapp as string | null) ?? null,
        alternateContact: (student.alternate_contact as string | null) ?? null,
        campusName: one<{ name?: string }>(student.campuses)?.name ?? "Unassigned campus",
        degree: one<{ name?: string }>(student.degrees)?.name ?? "",
        branch: one<{ name?: string }>(student.branches)?.name ?? "",
        passingYear: Number(student.passing_year ?? 0),
        srfStatus: student.srf_status as SrfStatus,
        participationStatus: student.participation_status as ParticipationStatus,
        tenthPercentage: student.tenth_percentage == null ? null : Number(student.tenth_percentage),
        tenthInstitution: (student.tenth_institution as string | null) ?? null,
        tenthBoard: (student.tenth_board as SchoolBoard | null) ?? null,
        twelfthPercentage:
          student.twelfth_percentage == null ? null : Number(student.twelfth_percentage),
        twelfthInstitution: (student.twelfth_institution as string | null) ?? null,
        twelfthBoard: (student.twelfth_board as SchoolBoard | null) ?? null,
        diplomaInstitution: (student.diploma_institution as string | null) ?? null,
        diplomaMarks: student.diploma_marks == null ? null : Number(student.diploma_marks),
        overallCgpa: student.overall_cgpa == null ? null : Number(student.overall_cgpa),
        currentArrears: Number(student.current_arrears ?? 0),
        historyOfArrears: Number(student.history_of_arrears ?? 0),
        semesters: semesterRows.map((row) => ({
          semesterNumber: Number(row.semester_number),
          cgpa: Number(row.cgpa),
          verified: row.status === "verified",
        })),
        skills: skillRows.map((row) => ({
          skill: one<{ name?: string }>(row.skill_areas)?.name ?? "Unnamed skill",
          score: Number(row.score),
        })),
        rolePreferences: preferenceRows.map((row) => row.category as RoleCategory),
        driveTypePreferences: (student.drive_type_preferences as DriveType[] | null) ?? [],
        technicalSkills: (student.technical_skills as string | null) ?? null,
        areasOfInterest: (student.areas_of_interest as string | null) ?? null,
        areasOfExpertise: (student.areas_of_expertise as string | null) ?? null,
        projects: (student.projects as string | null) ?? null,
        certifications: (student.certifications as string | null) ?? null,
        achievements: (student.achievements as string | null) ?? null,
        linkedinUrl: (student.linkedin_url as string | null) ?? null,
        githubUrl: (student.github_url as string | null) ?? null,
        leetcodeUrl: (student.leetcode_url as string | null) ?? null,
        hackerrankUrl: (student.hackerrank_url as string | null) ?? null,
        resumes,
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
        offers: allOffers,
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

    async updatePreferences(
      studentId: string,
      roleCategories: readonly RoleCategory[],
      driveTypePreferences: readonly DriveType[],
    ): Promise<void> {
      const { error } = await client.rpc("staff_update_student_preferences", {
        p_student_id: studentId,
        p_role_categories: [...roleCategories],
        p_drive_type_preferences: [...driveTypePreferences],
      });
      if (error !== null) {
        throw new Error(error.message || "Failed to update preferences");
      }
    },

    async uploadResume(studentId: string, roleCategory: RoleCategory, file: File): Promise<void> {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Resume file must be under 5 MB");
      }
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        throw new Error("Resume must be a PDF file");
      }

      const cleanName = sanitizeStorageFileName(file.name);
      const storagePath = `${studentId}/profile-${roleCategory}-${Date.now()}-${cleanName}`;

      const { error: uploadError } = await client.storage
        .from("resumes")
        .upload(storagePath, file, { upsert: true });

      if (uploadError !== null) {
        throw new Error(uploadError.message || "Could not upload resume to storage");
      }

      const { error: rpcError } = await client.rpc("staff_save_student_resume", {
        p_student_id: studentId,
        p_role_category: roleCategory,
        p_storage_path: storagePath,
        p_size_bytes: file.size,
      });

      if (rpcError !== null) {
        throw new Error(rpcError.message || "Could not record resume in database");
      }
    },
  };
}
