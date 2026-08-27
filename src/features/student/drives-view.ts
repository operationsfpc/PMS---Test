import { academicStandingFrom, type SemesterRecord } from "@domain/academics";
import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { describeDriveVenue } from "@domain/drive-venue";
import { describeJoining } from "@domain/joining";
import { highestOfferCategory, isInternshipCapConsumed, type Offer } from "@domain/offers";
import { describeShift } from "@domain/shift";
import { classifyStudentDrive } from "@domain/student-drive-lists";
import { type ApplicantRound, applicationProgress } from "@domain/student-progress";
import type { AcademicProfile, DriveStatus, RoleCategory } from "@domain/types";
import { canApply } from "@domain/visibility";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ApplyDrive,
  type ApplyRepository,
  type ApplyStudent,
  createSupabaseApplyRepository,
} from "./apply-repository";
import type {
  ClosedDriveRow,
  ConcludedDriveRow,
  ProgressDriveRow,
  StudentDriveLists,
  StudentDriveListsView,
} from "./drive-tabs";
import type { OpenDrive } from "./drives-list";
import { offerLettersByDrive, signOfferLetters } from "./offer-letters";

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
  area_not_chosen: "This drive is for an area you did not choose on your registration form.",
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
  // The attachment columns ride along with the ladder's: the same rows, one
  // round trip. UAT 2026-08-27 — the concluded drive says "Offer received"
  // and must be able to hand over the letter that says so.
  "id, drive_id, drive_type, offer_category, ctc_lpa, declared_at, source, attachment_path, attachment_name";

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const STUDENT_COLUMNS = `
  id, full_name, roll_number, email, passing_year, overall_cgpa, tenth_percentage,
  twelfth_percentage, current_arrears, history_of_arrears, technical_skills,
  srf_status, participation_status, drive_type_preferences,
  degrees(name), branches(name), campuses(name, cities(name)),
  student_documents!student_documents_student_id_fkey(id, kind, role_category, storage_path),
  student_role_preferences(category),
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
  shift_night_timing, timeline_notes, joining_timeline, joining_immediate_notes,
  joining_later_notes, jd_storage_path, jd_file_name,
  mandatory_skills, drive_mode, venue, openings, additional_designations,
  drive_eligible_degrees(degrees(name)),
  drive_eligible_branches(branches(name)),
  drive_target_campuses(campuses(name, cities(name))),
  drive_rounds(id, sequence, name)
`;

/**
 * N7: every status a student may read (0030's policy). The closed statuses
 * feed the two closed lists; `openDrives` still drops everything not live.
 */
const STUDENT_READABLE_STATUSES = ["live", "applications_closed", "in_rounds", "completed"];

/** Long enough to open and read a PDF on a phone; short enough not to be forwarded. */
const JD_LINK_TTL_SECONDS = 60 * 10;

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
): StudentDriveListsView {
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
      client.from("drives").select(DRIVE_COLUMNS).in("status", STUDENT_READABLE_STATUSES),
      client.from("applications").select("id, drive_id, applied_at").eq("student_id", row.id),
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
      resumeNames: Object.fromEntries(
        ((row.student_documents ?? []) as Array<Record<string, unknown>>)
          .filter((d) => d.kind === "resume" && d.role_category !== null)
          .map((d) => {
            // The display name is the storage path's last segment — the file
            // as it was uploaded (D2 shows it in the apply confirmation). A
            // path with no name still names the fact a resume is on file.
            const basename = ((d.storage_path as string | null) ?? "").split("/").at(-1);
            return [
              d.role_category as string,
              basename === undefined || basename === "" ? "your saved resume" : basename,
            ];
          }),
      ),
      // 2026-08-18: a drive reaches the students who asked for that area.
      roleCategories: ((row.student_role_preferences ?? []) as Array<Record<string, unknown>>)
        .map((p) => p.category as RoleCategory)
        .filter((c) => c !== undefined),
      // D1 (UAT 2026-08-19): and the students who asked for that drive TYPE.
      driveTypePreferences: (Array.isArray(row.drive_type_preferences)
        ? row.drive_type_preferences
        : []) as ApplyStudent["driveTypePreferences"],
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

    const applicationRows = (applications ?? []) as Array<{
      id: string;
      drive_id: string;
      applied_at: string;
    }>;

    return {
      student,
      drives: (drives ?? []) as Array<Record<string, unknown>>,
      applications: applicationRows,
      appliedIds: applicationRows.map((a) => a.drive_id),
      // The raw rows, kept alongside the domain `Offer`s: the ladder has no
      // business knowing about storage paths, and the screen does.
      offerRows: (offers ?? []) as Array<Record<string, unknown>>,
    };
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

  /**
   * One signed link per attached JD, for the whole list at once.
   *
   * Signed and short-lived, like every other document in the system (PRD
   * §21.2) — the bucket is private and `0051` lets a student read an object
   * only if they can read the drive whose folder it sits in.
   *
   * A failure is swallowed deliberately: the JD is one fact on a card, and a
   * list that refused to load over an unsignable object would leave the
   * student unable to apply to anything at all.
   */
  async function signJobDescriptions(
    drives: readonly Record<string, unknown>[],
  ): Promise<Map<string, string>> {
    const paths = drives
      .map((raw) => raw.jd_storage_path as string | null)
      .filter((path): path is string => typeof path === "string" && path !== "");

    const links = new Map<string, string>();
    if (paths.length === 0) return links;

    const { data } = await client.storage
      .from(JOB_DESCRIPTION_BUCKET)
      .createSignedUrls(paths, JD_LINK_TTL_SECONDS);

    for (const link of data ?? []) {
      if (link.path !== null && link.signedUrl !== null && link.signedUrl !== undefined) {
        links.set(link.path, link.signedUrl);
      }
    }

    return links;
  }

  return {
    async openDrives(): Promise<readonly OpenDrive[]> {
      const { student, drives, appliedIds } = await load();
      const now = clock();
      const jdLinks = await signJobDescriptions(drives);

      return drives.flatMap((raw) => {
        const drive = toDrive(raw);
        const verdict = canApply(
          {
            srfStatus: student.srfStatus,
            participationStatus: student.participationStatus,
            academics: student.academics,
            offers: student.offers,
            roleCategories: student.roleCategories,
            driveTypePreferences: student.driveTypePreferences,
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
            roleCategory: drive.roleCategory,
            // 2026-08-27: filtered on, and tagged on every card.
            driveType: drive.driveType,
            ctcLabel: max === null ? `₹${min ?? "—"} LPA` : `₹${min}–${max} LPA`,
            offerCategory: drive.offerCategory,
            applicationEnd: raw.application_end as string,
            canApply: verdict.allowed,
            refusal: verdict.allowed ? null : (REFUSALS[verdict.reason] ?? "Not open to you."),
            applied: appliedIds.includes(drive.id),
            // D2: the saved per-area resume that auto-fetches at apply time.
            profileResumeName: student.resumeNames[drive.roleCategory] ?? null,
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
              // J2/J3 (2026-08-18): worded by the domain, so the card and the
              // approver's queue cannot describe the same drive differently.
              shift: describeShift(
                raw.shift_type as string | null,
                raw.shift_night_timing as string | null,
              ),
              joining: describeJoining(
                raw.joining_timeline as string | null,
                ((raw.joining_immediate_notes ?? raw.joining_later_notes) as string | null) ??
                  (raw.timeline_notes as string | null),
              ),
              // J1 (answers 3 and 4): the student downloads what the recruiter
              // actually wrote, not the AE's one-line summary of it.
              jobDescriptionUrl: jdLinks.get((raw.jd_storage_path as string | null) ?? "") ?? null,
              jobDescriptionName: (raw.jd_file_name as string | null) ?? null,
              mandatorySkills: text(raw.mandatory_skills),
              driveMode: text(raw.drive_mode),
              // UAT 2026-08-21 item 2: worded by the domain — named when
              // recorded, "Venue to be confirmed" when the mode is off-campus
              // and the CPC has not recorded it yet. "" hides the row.
              venue:
                describeDriveVenue(
                  (raw.drive_mode as Parameters<typeof describeDriveVenue>[0]) ?? null,
                  (raw.venue as string | null) ?? null,
                ) ?? "",
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
      // D2: null means "send the saved per-area resume" — the snapshot
      // builder picks it when no drive-specific file arrives.
      await applyRepo.apply(student, toDrive(raw), appliedIds, clock(), resume ?? undefined);
    },

    /**
     * N7 — the four lists (approved 2026-08-19). One pass over everything the
     * student can read; `classifyStudentDrive` decides the list, so each
     * drive lands in exactly one.
     *
     * An APPLIED drive is never re-judged by R5: eligibility was settled at
     * apply time and snapshotted (R7). Re-hiding it now would disappear a
     * drive the student is mid-interview with.
     */
    async lists(): Promise<StudentDriveLists> {
      const { student, drives, applications, appliedIds, offerRows } = await load();
      const now = clock();

      // UAT 2026-08-27: the letter behind "Offer received".
      const letterByDrive = offerLettersByDrive(
        offerRows,
        await signOfferLetters(client, offerRows),
      );

      const applicationByDrive = new Map(applications.map((a) => [a.drive_id, a]));
      const applicationIds = applications.map((a) => a.id);

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
        ((participants ?? []) as Array<Record<string, unknown>>).map((p) =>
          key(p.application_id as string, p.round_id as string),
        ),
      );
      const resultBy = new Map(
        ((results ?? []) as Array<Record<string, unknown>>).map((r) => [
          key(r.application_id as string, r.round_id as string),
          r.result as ApplicantRound["result"],
        ]),
      );
      const attendanceBy = new Map(
        ((attendance ?? []) as Array<Record<string, unknown>>).map((a) => [
          key(a.application_id as string, a.round_id as string),
          a.status as ApplicantRound["attendance"],
        ]),
      );

      const toApplyIds = new Set<string>();
      const inProgress: ProgressDriveRow[] = [];
      const notApplied: ClosedDriveRow[] = [];
      const appliedClosed: ConcludedDriveRow[] = [];

      for (const raw of drives) {
        const drive = toDrive(raw);
        const driveStatus = raw.status as DriveStatus;
        const application = applicationByDrive.get(drive.id);

        if (application !== undefined) {
          const rounds: ApplicantRound[] = (
            Array.isArray(raw.drive_rounds) ? raw.drive_rounds : []
          ).map((r) => {
            const round = r as Record<string, unknown>;
            const at = key(application.id, round.id as string);
            return {
              sequence: Number(round.sequence ?? 0),
              name: String(round.name ?? "Round"),
              participating: sat.has(at),
              attendance: attendanceBy.get(at) ?? null,
              result: resultBy.get(at) ?? null,
            };
          });

          const progress = applicationProgress({
            rounds,
            hasOffer: student.offers.some((offer) => offer.driveId === drive.id),
          });

          const list = classifyStudentDrive(
            {
              applied: true,
              driveStatus,
              applicationEnd: drive.applicationEnd,
              stage: progress.stage,
            },
            now,
          );

          const row: ProgressDriveRow = {
            id: drive.id,
            companyName: raw.company_name as string,
            roleTitle: (raw.role_title as string | null) ?? "Role not specified",
            roleCategory: drive.roleCategory,
            driveType: drive.driveType,
            locations: text(raw.work_locations),
            appliedAt: application.applied_at,
            progressLabel: progress.label,
            roundsCleared: progress.roundsCleared,
            totalRounds: progress.totalRounds,
          };

          if (list === "applied_closed") {
            const letter = letterByDrive.get(drive.id) ?? null;
            appliedClosed.push({
              ...row,
              outcomeLabel: progress.label,
              offerLetterUrl: letter?.url ?? null,
              offerLetterName: letter?.name ?? null,
            });
          } else {
            inProgress.push(row);
          }
          continue;
        }

        const verdict = canApply(
          {
            srfStatus: student.srfStatus,
            participationStatus: student.participationStatus,
            academics: student.academics,
            offers: student.offers,
            roleCategories: student.roleCategories,
            driveTypePreferences: student.driveTypePreferences,
          },
          drive,
          now,
          appliedIds,
        );

        // R5's hides still hide: "you missed it" about a drive the student
        // was never eligible for is a reproach nobody earned.
        const hidden =
          !verdict.allowed &&
          !["window_not_open", "window_closed", "drive_not_live"].includes(verdict.reason);
        if (hidden) continue;

        const list = classifyStudentDrive(
          { applied: false, driveStatus, applicationEnd: drive.applicationEnd, stage: null },
          now,
        );

        if (list === "to_apply") {
          toApplyIds.add(drive.id);
        } else {
          const min = raw.ctc_min_lpa as number | null;
          const max = raw.ctc_max_lpa as number | null;
          notApplied.push({
            id: drive.id,
            companyName: raw.company_name as string,
            roleTitle: (raw.role_title as string | null) ?? "Role not specified",
            roleCategory: drive.roleCategory,
            driveType: drive.driveType,
            ctcLabel: max === null ? `₹${min ?? "—"} LPA` : `₹${min}–${max} LPA`,
            locations: text(raw.work_locations),
            closedOn: raw.application_end as string,
          });
        }
      }

      // The open cards go through the SAME builder as `openDrives`, so the
      // To-apply tab and the old list cannot describe a drive differently.
      const openCards = await this.openDrives();

      return {
        toApply: openCards.filter((card) => toApplyIds.has(card.id)),
        inProgress,
        notApplied,
        appliedClosed,
        // C2 (UAT 2026-08-19): the rung they hold, so the tabs can say what
        // remains open instead of looking shut.
        placedAt: highestOfferCategory(student.offers),
        // Q2 (UAT 2026-08-21): and whether the one-internship allowance is
        // used — the banner says internship-only drives are closed, instead
        // of promising "higher categories" while they quietly vanish.
        internshipCapConsumed: isInternshipCapConsumed(student.offers),
      };
    },
  };
}
