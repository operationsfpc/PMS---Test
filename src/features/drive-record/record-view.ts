import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { describeDriveVenue } from "@domain/drive-venue";
import { describeJoining } from "@domain/joining";
import type { OfferCategory } from "@domain/offer-category";
import { describeShift } from "@domain/shift";
import type { ApplicantRound } from "@domain/student-progress";
import type { AttendanceStatus, DriveStatus, RoleCategory, RoundResult } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * N1 — one canonical record per drive, reached from every list (approved
 * 2026-08-19). This view gathers EVERYTHING; the page decides what each role
 * is shown. RLS still decides what each role can FETCH — a student's request
 * for the applicant list comes back as their own application or nothing.
 */

export interface DriveProvenance {
  readonly raisedBy: string | null;
  readonly raisedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
}

export interface DriveRecruiterContact {
  readonly name: string;
  readonly designation: string;
  readonly email: string;
  readonly phone: string;
}

export interface DriveApplicantRow {
  readonly applicationId: string;
  /** C8: the stage list links each name to /students/:id. */
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly campus: string;
  readonly appliedAt: string;
  /** The APPLY-TIME snapshot (R7) — never the live profile. */
  readonly snapshot: Record<string, unknown>;
  /**
   * C8 (2026-08-21): the facts `filterFunnelStage` judges — so the clickable
   * counts on the Live card and this page's stage list agree by construction.
   */
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
  readonly rounds: readonly ApplicantRound[];
}

export interface DriveRecord {
  readonly id: string;
  readonly companyDriveId: string | null;
  readonly companyName: string;
  readonly industry: string;
  readonly companyWebsite: string;
  readonly roleTitle: string;
  readonly additionalDesignations: readonly string[];
  readonly roleCategory: RoleCategory | null;
  readonly status: DriveStatus;
  readonly driveType: string;
  readonly driveMode: string;
  /**
   * UAT 2026-08-21 item 2: already worded by `@domain/drive-venue` — the
   * venue itself, "Venue to be confirmed", or null when the mode has none.
   */
  readonly venue: string | null;
  readonly offerCategory: OfferCategory | null;
  readonly openings: number | null;
  readonly ctcLabel: string;
  readonly ctcBreakup: string;
  readonly bondDetails: string;
  readonly locations: string;
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  readonly tentativeDate: string | null;
  readonly shift: string;
  readonly joining: string;
  readonly jobDescription: string;
  readonly jobDescriptionUrl: string | null;
  readonly jobDescriptionName: string | null;
  readonly eligibility: {
    readonly cgpaLabel: string;
    readonly tenthLabel: string;
    readonly twelfthLabel: string;
    readonly arrearsLabel: string;
    readonly passingYears: readonly number[];
    readonly mandatorySkills: string;
    readonly degrees: readonly string[];
    readonly branches: readonly string[];
    readonly campuses: readonly string[];
  };
  readonly rounds: readonly { readonly sequence: number; readonly name: string }[];
  /**
   * A4 (UAT 2026-08-19): a drive carries any number of contacts now. Old
   * drives still answer through their legacy spoc_* columns, mapped into the
   * same list. Empty means the Central CPC is the point of contact (A5).
   */
  readonly recruiters: readonly DriveRecruiterContact[];
  readonly provenance: DriveProvenance;
  readonly applicants: readonly DriveApplicantRow[];
  /**
   * 2026-10-15: other roles under the same company drive event, so the page
   * can show "Other Roles in This Drive" — null/empty means this drive is
   * standalone or the only role.
   */
  readonly siblingRoles: readonly SiblingRole[];
}

export interface SiblingRole {
  readonly driveId: string;
  readonly roleTitle: string;
  readonly driveType: string | null;
  readonly status: DriveStatus;
  readonly ctcLabel: string;
  readonly stipendLabel: string | null;
}

/** A read this record cannot be assembled without. The page already says so. */
export class DriveRecordError extends Error {}

export interface DriveRecordView {
  record(driveId: string): Promise<DriveRecord | null>;
}

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * `drive_rounds` carries only its own columns. Embedded, PostgREST caps each
 * child collection at 1000 ROWS PER DRIVE — so on a big drive the round's
 * participants, results and attendance arrive truncated, and the applicant
 * list reads the missing rows as "this student did not sit the round". They
 * are read as their own paged queries below instead.
 */
export const RECORD_DRIVE_COLUMNS = `
  id, company_drive_id, company_name, industry, company_website, role_title, additional_designations,
  role_category, status, drive_type, drive_mode, venue, offer_category, openings,
  ctc_min_lpa, ctc_max_lpa, ctc_breakup, bond_details, work_locations,
  application_start, application_end, tentative_date,
  shift_type, shift_night_timing, joining_timeline, joining_immediate_notes,
  joining_later_notes, timeline_notes, job_description, jd_storage_path, jd_file_name,
  min_overall_cgpa, min_overall_cgpa_scale, min_tenth_percentage, min_twelfth_percentage,
  arrears_policy, eligible_passing_years, mandatory_skills,
  spoc_name, spoc_designation, spoc_email, spoc_phone,
  drive_contacts(sequence, name, designation, email, phone),
  created_at, approved_at, published_at,
  raised_by:profiles!drives_created_by_fkey(full_name),
  approver:profiles!drives_approved_by_fkey(full_name),
  publisher:profiles!drives_published_by_fkey(full_name),
  drive_rounds(id, sequence, name),
  drive_eligible_degrees(degrees(name)),
  drive_eligible_branches(branches(name)),
  drive_target_campuses(campuses(name))
`;

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const RECORD_APPLICANT_COLUMNS = `
  id, student_id, applied_at, profile_snapshot,
  students(full_name, roll_number, campuses(name)),
  shortlist_entries(included)
`;

const ARREARS_LABEL: Record<string, string> = {
  no_standing: "No standing arrears",
  no_history: "No history of arrears at all",
  flexible: "Flexible on arrears",
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

const asRows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

function linkedNames(rows: unknown, key: string): readonly string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => one<{ name?: string }>((row as Record<string, unknown>)[key])?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");
}

/**
 * A4: the drive_contacts rows, in order — or the legacy spoc_* columns as a
 * one-entry list, so a drive raised before 0053 still names its contact.
 */
function recruiterContacts(row: Record<string, unknown>): readonly DriveRecruiterContact[] {
  const rows = (Array.isArray(row.drive_contacts) ? row.drive_contacts : []) as Array<
    Record<string, unknown>
  >;
  if (rows.length > 0) {
    return rows
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
      .map((c) => ({
        name: text(c.name),
        designation: text(c.designation),
        email: text(c.email),
        phone: text(c.phone),
      }));
  }

  const legacy = {
    name: text(row.spoc_name),
    designation: text(row.spoc_designation),
    email: text(row.spoc_email),
    phone: text(row.spoc_phone),
  };
  const hasLegacy = Object.values(legacy).some((v) => v !== "");
  return hasLegacy ? [legacy] : [];
}

const JD_LINK_TTL_SECONDS = 60 * 10;

export function createSupabaseDriveRecordView(client: SupabaseClient): DriveRecordView {
  return {
    async record(driveId) {
      const { data: raw, error: driveError } = await client
        .from("drives")
        .select(RECORD_DRIVE_COLUMNS)
        .eq("id", driveId)
        .maybeSingle();

      // A refused read used to resolve with `data === null` and the page
      // greeted the coordinator with "This drive does not exist".
      if (driveError !== null) throw new DriveRecordError("Could not read this drive.");
      if (raw === null || raw === undefined) return null;
      const row = raw as Record<string, unknown>;

      // C8: who this drive made an offer to — one flag per applicant.
      const [applications, offerRows] = await Promise.all([
        readAllRows((from, to) =>
          client
            .from("applications")
            .select(RECORD_APPLICANT_COLUMNS)
            .eq("drive_id", driveId)
            .order("applied_at", { ascending: true })
            .range(from, to),
        ),
        readAllRows((from, to) =>
          client.from("offers").select("student_id").eq("drive_id", driveId).range(from, to),
        ),
      ]);

      const roundRows = asRows(row.drive_rounds).sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      );
      const roundIds = roundRows.map((r) => r.id as string);

      /**
       * One query per satellite table, id-batched and paged. Embedded under the
       * drive, each of these was capped at 1000 rows for the WHOLE drive — and
       * the page then read a dropped row as "not scheduled", "did not sit the
       * round", "no result declared". A truncated join is a wrong verdict, not
       * a missing column.
       */
      const [participantRows, resultRows, attendanceRows] = await Promise.all([
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("round_participants")
              .select("round_id, application_id")
              .in("round_id", batch)
              .range(from, to),
        ),
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("round_results")
              .select("round_id, application_id, result")
              .in("round_id", batch)
              .range(from, to),
        ),
        readAllRowsByIds(
          roundIds,
          (batch) => (from, to) =>
            client
              .from("attendance")
              .select("round_id, application_id, status")
              .in("round_id", batch)
              .range(from, to),
        ),
      ]);

      const pair = (roundId: unknown, applicationId: unknown) =>
        `${roundId as string}::${applicationId as string}`;
      const scheduled = new Set(participantRows.map((p) => pair(p.round_id, p.application_id)));
      const resultAt = new Map<string, RoundResult>(
        resultRows.map((r) => [pair(r.round_id, r.application_id), r.result as RoundResult]),
      );
      const presentAt = new Map<string, AttendanceStatus>(
        attendanceRows.map((a) => [
          pair(a.round_id, a.application_id),
          a.status as AttendanceStatus,
        ]),
      );
      const offered = new Set(offerRows.map((o) => o.student_id as string));

      // The same signed-and-short-lived treatment as everywhere else (0051).
      let jobDescriptionUrl: string | null = null;
      const jdPath = (row.jd_storage_path as string | null) ?? null;
      if (jdPath !== null && jdPath !== "") {
        const { data } = await client.storage
          .from(JOB_DESCRIPTION_BUCKET)
          .createSignedUrl(jdPath, JD_LINK_TTL_SECONDS);
        jobDescriptionUrl = data?.signedUrl ?? null;
      }

      // 2026-10-15: fetch sibling roles under the same company drive event,
      // so the page can show "Other Roles in This Drive".
      const companyDriveId = (row.company_drive_id as string | null) ?? null;
      let siblingRoles: SiblingRole[] = [];
      if (companyDriveId !== null) {
        const { data: siblingRows, error: siblingError } = await client
          .from("drives")
          .select(
            "id, role_title, drive_type, status, ctc_min_lpa, ctc_max_lpa, stipend_min_monthly, stipend_max_monthly",
          )
          .eq("company_drive_id", companyDriveId)
          .neq("id", driveId);

        // A refused read here used to answer `undefined`, and the card showed
        // "no other roles under this visit" — a wrong fact about a live drive.
        if (siblingError !== null) {
          throw new DriveRecordError("Could not read the other roles under this visit.");
        }

        siblingRoles = asRows(siblingRows).map((s) => {
          const sMin = (s.ctc_min_lpa as number | null) ?? null;
          const sMax = (s.ctc_max_lpa as number | null) ?? null;
          const stipendMin = (s.stipend_min_monthly as number | null) ?? null;
          const stipendMax = (s.stipend_max_monthly as number | null) ?? null;
          return {
            driveId: s.id as string,
            roleTitle: text(s.role_title),
            driveType: (s.drive_type as string | null) ?? null,
            status: s.status as DriveStatus,
            ctcLabel:
              sMin === null && sMax === null
                ? "Not stated"
                : sMax === null
                  ? `₹${sMin} LPA`
                  : `₹${sMin}–${sMax} LPA`,
            stipendLabel:
              stipendMin === null && stipendMax === null
                ? null
                : stipendMax === null
                  ? `₹${stipendMin} / month`
                  : `₹${stipendMin}–${stipendMax} / month`,
          };
        });
      }

      // `?? null` throughout: a column a select DID ask for still reads
      // `undefined` off a partial row, and `undefined === null` is false —
      // "≥ undefined CGPA" is the label that bug prints.
      const min = (row.ctc_min_lpa as number | null | undefined) ?? null;
      const max = (row.ctc_max_lpa as number | null | undefined) ?? null;
      const cgpa = (row.min_overall_cgpa as number | null | undefined) ?? null;
      const cgpaScale = (row.min_overall_cgpa_scale as string | null | undefined) ?? "cgpa";
      const tenth = (row.min_tenth_percentage as number | null | undefined) ?? null;
      const twelfth = (row.min_twelfth_percentage as number | null | undefined) ?? null;

      return {
        id: row.id as string,
        companyDriveId: companyDriveId,
        companyName: text(row.company_name),
        industry: text(row.industry),
        companyWebsite: text(row.company_website),
        roleTitle: text(row.role_title),
        additionalDesignations: (row.additional_designations as string[] | null) ?? [],
        roleCategory: (row.role_category as RoleCategory | null) ?? null,
        status: row.status as DriveStatus,
        driveType: text(row.drive_type),
        driveMode: text(row.drive_mode),
        venue: describeDriveVenue(
          (row.drive_mode as Parameters<typeof describeDriveVenue>[0]) ?? null,
          (row.venue as string | null) ?? null,
        ),
        offerCategory: (row.offer_category as OfferCategory | null) ?? null,
        openings: (row.openings as number | null) ?? null,
        ctcLabel:
          min === null && max === null
            ? "Not stated"
            : max === null
              ? `₹${min} LPA`
              : `₹${min}–${max} LPA`,
        ctcBreakup: text(row.ctc_breakup),
        bondDetails: text(row.bond_details),
        locations: text(row.work_locations),
        applicationStart: (row.application_start as string | null) ?? null,
        applicationEnd: (row.application_end as string | null) ?? null,
        tentativeDate: (row.tentative_date as string | null) ?? null,
        shift: describeShift(
          row.shift_type as string | null,
          row.shift_night_timing as string | null,
        ),
        joining: describeJoining(
          row.joining_timeline as string | null,
          ((row.joining_immediate_notes ?? row.joining_later_notes) as string | null) ??
            (row.timeline_notes as string | null),
        ),
        jobDescription: text(row.job_description),
        jobDescriptionUrl,
        jobDescriptionName: (row.jd_file_name as string | null) ?? null,
        eligibility: {
          cgpaLabel:
            cgpa === null
              ? "None declared"
              : cgpaScale === "percentage"
                ? `≥ ${cgpa}%`
                : `≥ ${cgpa} CGPA`,
          tenthLabel: tenth === null ? "None declared" : `≥ ${tenth}%`,
          twelfthLabel: twelfth === null ? "None declared" : `≥ ${twelfth}%`,
          arrearsLabel: ARREARS_LABEL[text(row.arrears_policy)] ?? "Flexible on arrears",
          passingYears: (row.eligible_passing_years as number[] | null) ?? [],
          mandatorySkills: text(row.mandatory_skills),
          degrees: linkedNames(row.drive_eligible_degrees, "degrees"),
          branches: linkedNames(row.drive_eligible_branches, "branches"),
          campuses: linkedNames(row.drive_target_campuses, "campuses"),
        },
        rounds: roundRows.map((r) => ({
          sequence: Number(r.sequence ?? 0),
          name: String(r.name ?? "Round"),
        })),
        recruiters: recruiterContacts(row),
        provenance: {
          raisedBy: one<{ full_name?: string }>(row.raised_by)?.full_name ?? null,
          raisedAt: (row.created_at as string | null) ?? null,
          approvedBy: one<{ full_name?: string }>(row.approver)?.full_name ?? null,
          approvedAt: (row.approved_at as string | null) ?? null,
          publishedBy: one<{ full_name?: string }>(row.publisher)?.full_name ?? null,
          publishedAt: (row.published_at as string | null) ?? null,
        },
        applicants: applications.map((a) => {
          const student = one<Record<string, unknown>>(a.students);
          const applicationId = a.id as string;
          const shortlistRows = asRows(a.shortlist_entries);

          // C8: the same facts the portfolio's funnel counts, assembled per
          // applicant so `filterFunnelStage` gives this page the same answer.
          const applicantRounds: ApplicantRound[] = roundRows.map((round) => {
            const at = pair(round.id, applicationId);
            return {
              sequence: Number(round.sequence ?? 0),
              name: String(round.name ?? "Round"),
              participating: scheduled.has(at),
              attendance: presentAt.get(at) ?? null,
              result: resultAt.get(at) ?? null,
            };
          });

          const snapshotEnvelope = (a.profile_snapshot ?? {}) as Record<string, unknown>;
          const snapshotProfile = (snapshotEnvelope.profile ?? snapshotEnvelope) as Record<
            string,
            unknown
          >;
          const snapshotAcademics = (snapshotProfile.academics ?? snapshotProfile) as Record<
            string,
            unknown
          >;

          return {
            applicationId,
            studentId: text(a.student_id),
            fullName:
              text(student?.full_name) || text(snapshotProfile.fullName) || "Unknown student",
            rollNumber: text(student?.roll_number) || text(snapshotProfile.rollNumber),
            campus:
              one<{ name?: string }>(student?.campuses)?.name ??
              text(snapshotAcademics.campus) ??
              "",
            appliedAt: a.applied_at as string,
            snapshot: snapshotEnvelope,
            shortlisted: shortlistRows.some((s) => s.included === true),
            hasOffer: offered.has(a.student_id as string),
            rounds: applicantRounds,
          };
        }),
        siblingRoles: siblingRoles,
      };
    },
  };
}
