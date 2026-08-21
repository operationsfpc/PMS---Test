import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { describeDriveVenue } from "@domain/drive-venue";
import { describeJoining } from "@domain/joining";
import type { OfferCategory } from "@domain/offer-category";
import { describeShift } from "@domain/shift";
import type { ApplicantRound } from "@domain/student-progress";
import type { DriveStatus, RoleCategory } from "@domain/types";
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
}

export interface DriveRecordView {
  record(driveId: string): Promise<DriveRecord | null>;
}

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const RECORD_DRIVE_COLUMNS = `
  id, company_name, industry, company_website, role_title, additional_designations,
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
  drive_rounds(
    sequence, name,
    round_participants(application_id),
    round_results(application_id, result),
    attendance(application_id, status)
  ),
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
      const [{ data: raw }, { data: applications }, { data: offerRows }] = await Promise.all([
        client.from("drives").select(RECORD_DRIVE_COLUMNS).eq("id", driveId).maybeSingle(),
        client
          .from("applications")
          .select(RECORD_APPLICANT_COLUMNS)
          .eq("drive_id", driveId)
          .order("applied_at", { ascending: true }),
        // C8: who this drive made an offer to — one flag per applicant.
        client.from("offers").select("student_id").eq("drive_id", driveId),
      ]);

      if (raw === null || raw === undefined) return null;
      const row = raw as Record<string, unknown>;

      // The same signed-and-short-lived treatment as everywhere else (0051).
      let jobDescriptionUrl: string | null = null;
      const jdPath = (row.jd_storage_path as string | null) ?? null;
      if (jdPath !== null && jdPath !== "") {
        const { data } = await client.storage
          .from(JOB_DESCRIPTION_BUCKET)
          .createSignedUrl(jdPath, JD_LINK_TTL_SECONDS);
        jobDescriptionUrl = data?.signedUrl ?? null;
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
        rounds: (Array.isArray(row.drive_rounds) ? row.drive_rounds : [])
          .map((r) => ({
            sequence: Number((r as Record<string, unknown>).sequence ?? 0),
            name: String((r as Record<string, unknown>).name ?? "Round"),
          }))
          .sort((a, b) => a.sequence - b.sequence),
        recruiters: recruiterContacts(row),
        provenance: {
          raisedBy: one<{ full_name?: string }>(row.raised_by)?.full_name ?? null,
          raisedAt: (row.created_at as string | null) ?? null,
          approvedBy: one<{ full_name?: string }>(row.approver)?.full_name ?? null,
          approvedAt: (row.approved_at as string | null) ?? null,
          publishedBy: one<{ full_name?: string }>(row.publisher)?.full_name ?? null,
          publishedAt: (row.published_at as string | null) ?? null,
        },
        applicants: ((applications ?? []) as Array<Record<string, unknown>>).map((a) => {
          const student = one<Record<string, unknown>>(a.students);
          const applicationId = a.id as string;
          const shortlistRows = (
            Array.isArray(a.shortlist_entries) ? a.shortlist_entries : []
          ) as Array<Record<string, unknown>>;
          const offered = new Set(
            ((offerRows ?? []) as Array<Record<string, unknown>>).map(
              (o) => o.student_id as string,
            ),
          );

          // C8: the same facts the portfolio's funnel counts, assembled per
          // applicant so `filterFunnelStage` gives this page the same answer.
          const applicantRounds: ApplicantRound[] = (
            Array.isArray(row.drive_rounds) ? (row.drive_rounds as unknown[]) : []
          )
            .map((r) => {
              const round = r as Record<string, unknown>;
              const inRows = (key: string) =>
                (Array.isArray(round[key]) ? (round[key] as unknown[]) : []).filter(
                  (entry) => (entry as Record<string, unknown>).application_id === applicationId,
                ) as Array<Record<string, unknown>>;
              const result = inRows("round_results")[0];
              const attendanceRow = inRows("attendance")[0];
              return {
                sequence: Number(round.sequence ?? 0),
                name: String(round.name ?? "Round"),
                participating: inRows("round_participants").length > 0,
                attendance:
                  (attendanceRow?.status as ApplicantRound["attendance"] | undefined) ?? null,
                result: (result?.result as ApplicantRound["result"] | undefined) ?? null,
              };
            })
            .sort((x, y) => x.sequence - y.sequence);

          return {
            applicationId,
            studentId: text(a.student_id),
            fullName: text(student?.full_name) || "Unknown student",
            rollNumber: text(student?.roll_number),
            campus: one<{ name?: string }>(student?.campuses)?.name ?? "",
            appliedAt: a.applied_at as string,
            snapshot: (a.profile_snapshot ?? {}) as Record<string, unknown>,
            shortlisted: shortlistRows.some((s) => s.included === true),
            hasOffer: offered.has(a.student_id as string),
            rounds: applicantRounds,
          };
        }),
      };
    },
  };
}
