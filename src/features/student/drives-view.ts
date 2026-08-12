import { academicStandingFrom, type SemesterRecord } from "@domain/academics";
import type { Offer } from "@domain/offers";
import type { AcademicProfile, RoleCategory } from "@domain/types";
import { canApply } from "@domain/visibility";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ApplyDrive,
  type ApplyRepository,
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

/** A nullable text column, as the screen wants it: "" never null. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const REFUSALS: Record<string, string> = {
  window_not_open: "Applications for this drive have not opened yet.",
  window_closed: "Applications for this drive have closed.",
  already_applied: "You have already applied to this drive.",
  drive_not_live: "This drive is not open.",
};

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real
 * schema. The previous select named a column offers does not have (`status`),
 * so PostgREST refused the WHOLE query, the error was swallowed, and the
 * category ladder judged every student as never placed — which is exactly the
 * "students can apply to any category" blocker reported on 2026-08-12.
 */
export const OFFER_LADDER_COLUMNS =
  "id, drive_id, drive_type, offer_category, ctc_lpa, declared_at, source";

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const STUDENT_COLUMNS = `
  id, full_name, roll_number, email, passing_year, overall_cgpa, tenth_percentage,
  twelfth_percentage, current_arrears, history_of_arrears, technical_skills,
  srf_status, participation_status,
  degrees(name), branches(name), campuses(name, cities(name)),
  student_documents!student_documents_student_id_fkey(id, kind, role_category),
  student_semesters(semester_number, cgpa, current_arrears, history_of_arrears, status)
`;

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * The three link tables are the drive's TARGETING, chosen by the Central CPC
 * on the publish screen. They were not loaded here at all, and because
 * `evaluateEligibility` treats an empty list as "any, never none", every
 * targeted drive was silently open to the whole roster - a B.E CSE drive at
 * one campus was visible, and applyable, to a BCA student at another.
 */
export const DRIVE_COLUMNS = `
  id, company_name, role_title, role_category, drive_type, offer_category,
  open_to_all_override, status, application_start, application_end,
  ctc_min_lpa, ctc_max_lpa, min_overall_cgpa, min_tenth_percentage,
  min_twelfth_percentage, arrears_policy, eligible_passing_years,
  job_description, work_locations, ctc_breakup, bond_details, shift_type,
  mandatory_skills, drive_mode, openings, additional_designations,
  drive_eligible_degrees(degrees(name)),
  drive_eligible_branches(branches(name)),
  drive_target_campuses(campuses(name, cities(name))),
  drive_rounds(sequence, name)
`;

/** Names out of an embedded link table, e.g. drive_eligible_degrees(degrees(name)). */
function linkedNames(rows: unknown, key: string): readonly string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => one<{ name?: string }>((row as Record<string, unknown>)[key])?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");
}

/** Cities are reached through the targeted campus, which is where they live. */
function targetedCities(rows: unknown): readonly string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(
      (row) =>
        one<{ name?: string }>(
          one<{ cities?: unknown }>((row as Record<string, unknown>).campuses)?.cities,
        )?.name,
    )
    .filter((name): name is string => typeof name === "string" && name !== "");
}

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
  /** Injected only by tests; production always uses the real repository. */
  applyRepo: ApplyRepository = createSupabaseApplyRepository(client),
): DrivesView {
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
      client.from("offers").select(OFFER_LADDER_COLUMNS).eq("student_id", row.id),
    ]);

    /**
     * Confirmed 2026-08-04: eligibility is judged on the LATEST VERIFIED
     * semester. A student types their own marks, so an unverified line
     * deciding whether they may apply would let anyone qualify by typing 10.
     *
     * The roster figures remain the fallback rather than a hard failure: on
     * the day this ships nobody has a verified semester, and locking every
     * student out of every drive is a worse answer than the number the
     * coordinator already imported.
     */
    const semesters = ((row.student_semesters ?? []) as Array<Record<string, unknown>>).map(
      (s): SemesterRecord => ({
        semesterNumber: Number(s.semester_number),
        cgpa: Number(s.cgpa),
        currentArrears: Number(s.current_arrears ?? 0),
        historyOfArrears: Number(s.history_of_arrears ?? 0),
        verified: s.status === "verified",
      }),
    );

    const standing = academicStandingFrom(semesters);

    const academics: AcademicProfile = {
      degree: one<{ name: string }>(row.degrees)?.name ?? "",
      branch: one<{ name: string }>(row.branches)?.name ?? "",
      passingYear: row.passing_year as number,
      overallCgpa: standing?.cgpa ?? (row.overall_cgpa as number | null) ?? 0,
      tenthPercentage: (row.tenth_percentage as number | null) ?? 0,
      twelfthPercentage: (row.twelfth_percentage as number | null) ?? 0,
      currentArrears: standing?.currentArrears ?? (row.current_arrears as number | null) ?? 0,
      historyOfArrears:
        standing?.historyOfArrears ?? (row.history_of_arrears as number | null) ?? 0,
      // City is its own table now, so it arrives nested one level deeper.
      // R2 still matches a drive's targetCities by name, so the name is what
      // the domain needs here - not the id.
      city: one<{ name: string }>(one<{ cities: unknown }>(row.campuses)?.cities)?.name ?? "",
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
      // Mapped field by field: PostgREST rows are snake_case and the domain
      // is camelCase. The old blanket cast left driveType/source undefined,
      // so even a correct select fed the ladder nothing.
      offers: ((offers ?? []) as Array<Record<string, unknown>>).map(
        (o): Offer => ({
          id: o.id as string,
          driveId: (o.drive_id as string | null) ?? "",
          driveType: o.drive_type as Offer["driveType"],
          offerCategory: (o.offer_category as Offer["offerCategory"]) ?? null,
          ctcLpa: Number(o.ctc_lpa),
          declaredAt: new Date(o.declared_at as string),
          source: o.source as Offer["source"],
        }),
      ),
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
        eligibleDegrees: linkedNames(raw.drive_eligible_degrees, "degrees"),
        eligibleBranches: linkedNames(raw.drive_eligible_branches, "branches"),
        eligiblePassingYears: (raw.eligible_passing_years as number[]) ?? [],
        minOverallCgpa: (raw.min_overall_cgpa as number | null) ?? null,
        minTenthPercentage: (raw.min_tenth_percentage as number | null) ?? null,
        minTwelfthPercentage: (raw.min_twelfth_percentage as number | null) ?? null,
        arrearPolicy: (raw.arrears_policy as "flexible") ?? "flexible",
        targetCities: targetedCities(raw.drive_target_campuses),
        targetCampuses: linkedNames(raw.drive_target_campuses, "campuses"),
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
            // F14: everything behind "View more". A student is about to
            // promise to attend every round of this drive and to accept an
            // offer from it; a company name and a CTC is not enough to decide
            // that on.
            details: {
              jobDescription: text(raw.job_description),
              designations: (raw.additional_designations as string[] | null) ?? [],
              locations: text(raw.work_locations),
              openings: (raw.openings as number | null) ?? null,
              ctcBreakup: text(raw.ctc_breakup),
              bondDetails: text(raw.bond_details),
              shiftType: text(raw.shift_type),
              mandatorySkills: text(raw.mandatory_skills),
              driveMode: text(raw.drive_mode),
              applicationStart: (raw.application_start as string | null) ?? null,
              rounds: (Array.isArray(raw.drive_rounds) ? raw.drive_rounds : [])
                .map((r) => ({
                  sequence: Number((r as Record<string, unknown>).sequence ?? 0),
                  name: String((r as Record<string, unknown>).name ?? "Round"),
                }))
                .sort((a, b) => a.sequence - b.sequence),
            },
          },
        ];
      });
    },

    async apply(driveId, resume) {
      const { student, drives, appliedIds } = await load();
      const raw = drives.find((d) => d.id === driveId);
      if (raw === undefined) throw new Error("Drive not found");
      await applyRepo.apply(student, toDrive(raw), appliedIds, clock(), resume);
    },
  };
}
