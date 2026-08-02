import type { Offer } from "@domain/offers";
import type { AcademicProfile, RoleCategory } from "@domain/types";
import { canApply } from "@domain/visibility";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ApplyDrive,
  type ApplyStudent,
  createSupabaseApplyRepository,
} from "./apply-repository";
import type { DrivesView, OpenDrive } from "./drives-list";

/**
 * PostgREST returns an embedded to-one relation as an object, but the generated
 * types describe it as an array, and the shape differs with how the join is
 * inferred. Tolerate both rather than casting past it.
 */
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

const REFUSALS: Record<string, string> = {
  window_not_open: "Applications for this drive have not opened yet.",
  window_closed: "Applications for this drive have closed.",
  already_applied: "You have already applied to this drive.",
  drive_not_live: "This drive is not open.",
};

const STUDENT_COLUMNS = `
  id, full_name, roll_number, email, passing_year, overall_cgpa, tenth_percentage,
  twelfth_percentage, current_arrears, history_of_arrears, technical_skills,
  srf_status, participation_status,
  degrees(name), branches(name), campuses(name, city),
  student_documents(id, kind, role_category)
`;

const DRIVE_COLUMNS = `
  id, company_name, role_title, role_category, drive_type, offer_category,
  open_to_all_override, status, application_start, application_end,
  ctc_min_lpa, ctc_max_lpa, min_overall_cgpa, min_tenth_percentage,
  min_twelfth_percentage, arrears_policy, eligible_passing_years
`;

/**
 * Assembles the student's drive list.
 *
 * R5 runs here, not in the screen. A drive hidden by the category ladder, the
 * internship cap, opt-out, disbarment or eligibility is dropped entirely -
 * showing a student a drive they can never apply to invites a support ticket
 * and reveals other students' outcomes by implication.
 *
 * A drive that is visible but currently unapplyable (window not open, already
 * applied) is kept, with the reason, because that is information the student
 * needs.
 */
export function createSupabaseDrivesView(
  client: SupabaseClient,
  getAuthUserId: () => Promise<string | null> = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
  clock: () => Date = () => new Date(),
): DrivesView {
  const applyRepo = createSupabaseApplyRepository(client);

  async function load() {
    const userId = await getAuthUserId();
    if (userId === null) throw new Error("No session");

    const { data: row } = await client
      .from("students")
      .select(STUDENT_COLUMNS)
      .eq("auth_user_id", userId)
      .single();

    if (!row) throw new Error("No student record");

    const [{ data: drives }, { data: applications }, { data: offers }] = await Promise.all([
      client.from("drives").select(DRIVE_COLUMNS).eq("status", "live"),
      client.from("applications").select("drive_id").eq("student_id", row.id),
      client.from("offers").select("drive_type, offer_category, status").eq("student_id", row.id),
    ]);

    const academics: AcademicProfile = {
      degree: one<{ name: string }>(row.degrees)?.name ?? "",
      branch: one<{ name: string }>(row.branches)?.name ?? "",
      passingYear: row.passing_year as number,
      overallCgpa: (row.overall_cgpa as number | null) ?? 0,
      tenthPercentage: (row.tenth_percentage as number | null) ?? 0,
      twelfthPercentage: (row.twelfth_percentage as number | null) ?? 0,
      currentArrears: (row.current_arrears as number | null) ?? 0,
      historyOfArrears: (row.history_of_arrears as number | null) ?? 0,
      city: one<{ city: string }>(row.campuses)?.city ?? "",
      campus: one<{ name: string }>(row.campuses)?.name ?? "",
    };

    const student: ApplyStudent = {
      id: row.id as string,
      fullName: row.full_name as string,
      rollNumber: row.roll_number as string,
      email: row.email as string,
      degree: academics.degree,
      branch: academics.branch,
      passingYear: academics.passingYear,
      overallCgpa: academics.overallCgpa,
      tenthPercentage: academics.tenthPercentage,
      twelfthPercentage: academics.twelfthPercentage,
      currentArrears: academics.currentArrears,
      historyOfArrears: academics.historyOfArrears,
      technicalSkills: (row.technical_skills as string | null) ?? "",
      resumes: ((row.student_documents ?? []) as Array<Record<string, unknown>>)
        .filter((d) => d.kind === "resume" && d.role_category !== null)
        .map((d) => ({ id: d.id as string, roleCategory: d.role_category as RoleCategory })),
      srfStatus: row.srf_status as ApplyStudent["srfStatus"],
      participationStatus: row.participation_status as ApplyStudent["participationStatus"],
      academics,
      offers: (offers ?? []) as unknown as readonly Offer[],
    };

    const appliedIds = ((applications ?? []) as Array<{ drive_id: string }>).map((a) => a.drive_id);

    return { student, drives: (drives ?? []) as Array<Record<string, unknown>>, appliedIds };
  }

  function toDrive(raw: Record<string, unknown>): ApplyDrive {
    return {
      id: raw.id as string,
      status: raw.status as ApplyDrive["status"],
      driveType: raw.drive_type as ApplyDrive["driveType"],
      offerCategory: (raw.offer_category as ApplyDrive["offerCategory"]) ?? null,
      openToAllOverride: Boolean(raw.open_to_all_override),
      applicationStart: new Date(raw.application_start as string),
      applicationEnd: new Date(raw.application_end as string),
      roleCategory: raw.role_category as RoleCategory,
      criteria: {
        eligibleDegrees: [],
        eligibleBranches: [],
        eligiblePassingYears: (raw.eligible_passing_years as number[]) ?? [],
        minOverallCgpa: (raw.min_overall_cgpa as number | null) ?? null,
        minTenthPercentage: (raw.min_tenth_percentage as number | null) ?? null,
        minTwelfthPercentage: (raw.min_twelfth_percentage as number | null) ?? null,
        arrearPolicy: (raw.arrears_policy as "flexible") ?? "flexible",
        targetCities: [],
        targetCampuses: [],
      },
    };
  }

  return {
    async openDrives(): Promise<readonly OpenDrive[]> {
      const { student, drives, appliedIds } = await load();
      const now = clock();

      return drives.flatMap((raw) => {
        const drive = toDrive(raw);
        const verdict = canApply(
          {
            srfStatus: student.srfStatus,
            participationStatus: student.participationStatus,
            academics: student.academics,
            offers: student.offers,
          },
          drive,
          now,
          appliedIds,
        );

        // Hidden by R5 - not merely unapplyable. Drop it entirely.
        const hidden =
          !verdict.allowed &&
          !["window_not_open", "window_closed", "already_applied"].includes(verdict.reason);
        if (hidden) return [];

        const min = raw.ctc_min_lpa as number | null;
        const max = raw.ctc_max_lpa as number | null;

        return [
          {
            id: drive.id,
            companyName: raw.company_name as string,
            roleTitle: (raw.role_title as string | null) ?? "Role not specified",
            ctcLabel: max === null ? `₹${min ?? "—"} LPA` : `₹${min}–${max} LPA`,
            offerCategory: drive.offerCategory,
            applicationEnd: raw.application_end as string,
            canApply: verdict.allowed,
            refusal: verdict.allowed ? null : (REFUSALS[verdict.reason] ?? "Not open to you."),
            applied: appliedIds.includes(drive.id),
          },
        ];
      });
    },

    async apply(driveId) {
      const { student, drives, appliedIds } = await load();
      const raw = drives.find((d) => d.id === driveId);
      if (raw === undefined) throw new Error("Drive not found");
      await applyRepo.apply(student, toDrive(raw), appliedIds, clock());
    },
  };
}
