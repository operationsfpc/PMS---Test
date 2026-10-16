import type { DriveProgressStudentItem } from "@components/drive-progress-modal";
import { countDistinctEvents } from "@domain/company-drive";
import type { PlacementCtc } from "@domain/ctc-statistics";
import { isShortlisted, type RoundParticipant } from "@domain/drive-funnel";
import { type Offer, resolvePlacementRecord } from "@domain/offers";
import type {
  AcademicProfile,
  AttendanceStatus,
  DriveStatus,
  DriveType,
  ParticipationStatus,
  RoundResult,
  SrfStatus,
} from "@domain/types";
import { isDriveVisibleToStudent, type VisibleDrive } from "@domain/visibility";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CampusBreakdown,
  DashboardSnapshot,
  DashboardView,
  DriveProgressSnapshot,
  LiveDrive,
  StatusDriveItem,
} from "./dashboard-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/** Names out of an embedded link table, e.g. drive_eligible_degrees(degrees(name)). */
const linkedNames = (value: unknown, key: string): readonly string[] =>
  rows(value)
    .map((row) => one<{ name?: string }>(row[key])?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * The link tables are the drive's targeting. Without them every targeted drive
 * would count the whole roster as eligible - see the same fix in drives-view.
 */
export const DASHBOARD_LIVE_DRIVE_COLUMNS = `
  id, company_name, role_title, status, drive_type, offer_category,
  tentative_date,
  open_to_all_override, application_start, application_end,
  min_overall_cgpa, min_tenth_percentage, min_twelfth_percentage,
  arrears_policy, eligible_passing_years,
  drive_eligible_degrees(degrees(name)),
  drive_eligible_branches(branches(name)),
  drive_target_campuses(campuses(name, cities(name)))
`;

/**
 * The drive-specific box (F5). Exported so src/db/query-contract.test.ts can
 * prove it against the real schema.
 *
 * 2026-10-16: this is now the ONLY drives read on the overview. It was two —
 * this one, and a `select("status")` that fed "Drives by status" and its
 * popup. The popup mapped `company_name` off the status-only rows, found
 * nothing, and printed "Unnamed drive" for every drive in the organisation.
 */
export const DASHBOARD_DRIVE_BOX_COLUMNS = `
  id, company_name, role_title, status, drive_type,
  tentative_date,
  drive_target_campuses(campuses(name))
`;

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const DASHBOARD_COHORT_COLUMNS = `
  id, full_name, roll_number, participation_status, srf_status, campus_id, passing_year,
  overall_cgpa, tenth_percentage, twelfth_percentage,
  current_arrears, history_of_arrears,
  degrees(name), branches(name), campuses(name, cities(name))
`;

/** Exported for the same reason. */
export const DASHBOARD_OFFER_COLUMNS =
  "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, stipend_monthly, declared_at";

/** Drive types that count as an on-campus PLACEMENT. An internship is not one. */
const PLACEMENT_TYPES = new Set(["placement", "internship_convertible"]);

/**
 * Feeds every dashboard.
 *
 * It gathers facts and nothing else: which students exist, and which of them
 * hold which kind of offer. Every judgement - who counts, what a placement is,
 * what the rate is - belongs to src/domain/statistics.ts.
 *
 * Two scopes, deliberately different:
 *  - `campusIds` (constructor) is what this READER may see, e.g. a Campus
 *    Manager's own colleges;
 *  - `scope.campusIds` (per snapshot) is the college they switched to on the
 *    screen. Only the roster used to follow the switcher, so the funnel and the
 *    placement figures were one campus while the packages, the open drives and
 *    the drive box were the whole organisation — two cohorts quoted side by side.
 *
 * Every read is paged and every error is raised. A failed read used to resolve
 * with `data: null`, which this view rendered as "No students yet".
 */
export function createSupabaseDashboardView(
  client: SupabaseClient,
  campusIds?: readonly string[],
  /** Injected so the drive clock is testable; never read inside a component. */
  clock: () => Date = () => new Date(),
): DashboardView {
  const readable = campusIds === undefined || campusIds.length === 0 ? null : campusIds;

  return {
    async snapshot(
      scope: { readonly campusIds?: readonly string[] } = {},
    ): Promise<DashboardSnapshot> {
      const chosen = scope.campusIds;
      const switched = chosen === undefined || chosen.length === 0 ? null : chosen;

      const inScope =
        readable === null
          ? switched
          : switched === null
            ? readable
            : readable.filter((id) => switched.includes(id));

      const cohortRows = rows(
        await readAllRows((from, to) =>
          inScope === null
            ? client.from("students").select(DASHBOARD_COHORT_COLUMNS).range(from, to)
            : client
                .from("students")
                .select(DASHBOARD_COHORT_COLUMNS)
                .in("campus_id", inScope)
                .range(from, to),
        ),
        // The switcher applied client-side too, so a campus a stale grant let
        // through cannot join the figures printed beside it.
      ).filter((s) => inScope === null || inScope.includes(s.campus_id as string));

      const studentIds = cohortRows.map((s) => s.id as string);

      const [offerRows, appliedRows] = await Promise.all([
        studentIds.length === 0
          ? Promise.resolve([] as Array<Record<string, unknown>>)
          : // `id` is not decoration: the drive box counts shortlist entries
            // and round participants, both of which key on the APPLICATION.
            readAllRowsByIds(
              studentIds,
              (batch) => (from, to) =>
                client
                  .from("offers")
                  .select(DASHBOARD_OFFER_COLUMNS)
                  .in("student_id", batch)
                  .range(from, to),
            ),
        studentIds.length === 0
          ? Promise.resolve([] as Array<Record<string, unknown>>)
          : readAllRowsByIds(
              studentIds,
              (batch) => (from, to) =>
                client
                  .from("applications")
                  .select("id, student_id, drive_id")
                  .in("student_id", batch)
                  .range(from, to),
            ),
      ]);

      const [openDrives, driveRows] = await Promise.all([
        readAllRows((from, to) =>
          client
            .from("drives")
            .select(DASHBOARD_LIVE_DRIVE_COLUMNS)
            .eq("status", "live")
            .range(from, to),
        ),
        // F5: the drive-specific box. Read for EVERY drive, not just the live
        // ones - a drive in its rounds is exactly the one a coordinator is
        // chasing, and it is no longer open for applications.
        readAllRows((from, to) =>
          client.from("drives").select(DASHBOARD_DRIVE_BOX_COLUMNS).range(from, to),
        ),
      ]);

      const [roundRows, participantRows, attendanceRows, resultRows, shortlistRows] =
        await Promise.all([
          readAllRows((from, to) =>
            client.from("drive_rounds").select("id, drive_id, sequence, name").range(from, to),
          ),
          readAllRows((from, to) =>
            client.from("round_participants").select("round_id, application_id").range(from, to),
          ),
          readAllRows((from, to) =>
            client.from("attendance").select("round_id, application_id, status").range(from, to),
          ),
          readAllRows((from, to) =>
            client.from("round_results").select("round_id, application_id, result").range(from, to),
          ),
          readAllRows((from, to) =>
            client.from("shortlist_entries").select("application_id, included").range(from, to),
          ),
        ]);

      const onCampus = new Set<string>();
      const selfPlaced = new Set<string>();

      // Kept per student so R9 can pick the ONE offer that is their placement
      // record. Averaging every row instead would count a student holding three
      // offers three times and inflate the package.
      const offersByStudent = new Map<string, Offer[]>();

      const applied = new Set(appliedRows.map((a) => a.student_id as string));

      for (const offer of offerRows) {
        const studentId = offer.student_id as string;

        const forStudent = offersByStudent.get(studentId) ?? [];
        forStudent.push({
          id: offer.id as string,
          driveId: (offer.drive_id as string | null) ?? "",
          driveType: offer.drive_type as DriveType,
          offerCategory: (offer.offer_category as Offer["offerCategory"]) ?? null,
          ctcLpa: Number(offer.ctc_lpa ?? 0),
          declaredAt: new Date(offer.declared_at as string),
          source: offer.source as Offer["source"],
        });
        offersByStudent.set(studentId, forStudent);

        if (offer.source === "self_placed") {
          selfPlaced.add(studentId);
          continue;
        }

        if (PLACEMENT_TYPES.has(offer.drive_type as string)) {
          onCampus.add(studentId);
        }
      }

      // ------------------------------------------------- drives, statuses, events
      /** The drives behind those counts, so a status row opens what it counted. */
      const statusDrives: StatusDriveItem[] = driveRows
        .map((row) => ({
          driveId: row.id as string,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? null,
          status: (row.status as string | null) ?? "draft",
          driveType: (row.drive_type as DriveType | null) ?? null,
          // 2026-10-16: the event the role belongs to. Without it a company's
          // three roles were three cards, and "3 completed" was one visit.
          companyDriveId: (row.company_drive_id as string | null) ?? null,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          campuses: linkedNames(row.drive_target_campuses, "campuses"),
        }))
        .sort(
          (a, b) => a.status.localeCompare(b.status) || a.companyName.localeCompare(b.companyName),
        );

      /**
       * Distinct company VISITS per status. A TCS that raised three roles for
       * one visit is one completed drive — which is what the row beside the
       * count opens, so the two could never be allowed to disagree.
       */
      const drivesByStatus: Record<string, number> = {};
      for (const status of new Set(statusDrives.map((drive) => drive.status))) {
        drivesByStatus[status] = countDistinctEvents(
          statusDrives.filter((drive) => drive.status === status),
        );
      }

      // Per-campus counts use the same definitions, so a campus row can never
      // disagree with the headline.
      const campusTotals = new Map<string, CampusBreakdown>();
      for (const row of cohortRows) {
        const campusId = (row.campus_id as string | null) ?? "unknown";
        const campusName = one<{ name?: string }>(row.campuses)?.name ?? "Unassigned campus";

        const current = campusTotals.get(campusId) ?? {
          campusId,
          campusName,
          eligible: 0,
          placed: 0,
        };

        const optedOut = (row.participation_status as ParticipationStatus) === "opted_out";
        const placed = onCampus.has(row.id as string);

        campusTotals.set(campusId, {
          ...current,
          eligible: current.eligible + (optedOut ? 0 : 1),
          placed: current.placed + (placed && !optedOut ? 1 : 0),
        });
      }

      /**
       * "Eligible" is the honest R5 number: the students this drive is
       * actually open to. Counting the roster instead would make every
       * conversion look terrible and every targeted drive look ignored.
       *
       * Run over the students in scope, so a campus switcher's eligible count
       * is that campus - the same scoping as every other figure here.
       */
      const contexts = cohortRows.map((row) => {
        const campus = one<{ name?: string; cities?: unknown }>(row.campuses);
        const academics: AcademicProfile = {
          degree: one<{ name?: string }>(row.degrees)?.name ?? "",
          branch: one<{ name?: string }>(row.branches)?.name ?? "",
          passingYear: Number(row.passing_year ?? 0),
          overallCgpa: Number(row.overall_cgpa ?? 0),
          tenthPercentage: Number(row.tenth_percentage ?? 0),
          twelfthPercentage: Number(row.twelfth_percentage ?? 0),
          currentArrears: Number(row.current_arrears ?? 0),
          historyOfArrears: Number(row.history_of_arrears ?? 0),
          city: one<{ name?: string }>(campus?.cities)?.name ?? "",
          campus: campus?.name ?? "",
        };

        return {
          studentId: row.id as string,
          srfStatus: (row.srf_status as SrfStatus | null) ?? "invited",
          participationStatus: (row.participation_status as ParticipationStatus) ?? "active",
          academics,
          offers: offersByStudent.get(row.id as string) ?? [],
        };
      });

      // Reused by the drive box, so "eligible" means the same R5 number in
      // both places on the screen.
      const eligibleByDrive = new Map<string, number>();

      const liveDrives: LiveDrive[] = openDrives.map((row): LiveDrive => {
        const driveId = row.id as string;
        const start = row.application_start as string | null;
        const end = row.application_end as string | null;

        const drive: VisibleDrive = {
          id: driveId,
          status: (row.status as DriveStatus | null) ?? "live",
          driveType: (row.drive_type as DriveType | null) ?? "placement",
          offerCategory: (row.offer_category as VisibleDrive["offerCategory"]) ?? null,
          openToAllOverride: Boolean(row.open_to_all_override),
          // R5 itself never reads the window; canApply does. Any instant is
          // therefore safe here, and the epoch is the honest placeholder.
          applicationStart: new Date(start ?? 0),
          applicationEnd: new Date(end ?? 0),
          criteria: {
            eligibleDegrees: linkedNames(row.drive_eligible_degrees, "degrees"),
            eligibleBranches: linkedNames(row.drive_eligible_branches, "branches"),
            eligiblePassingYears: (row.eligible_passing_years as number[]) ?? [],
            minOverallCgpa: (row.min_overall_cgpa as number | null) ?? null,
            minTenthPercentage: (row.min_tenth_percentage as number | null) ?? null,
            minTwelfthPercentage: (row.min_twelfth_percentage as number | null) ?? null,
            arrearPolicy: (row.arrears_policy as "flexible") ?? "flexible",
            targetCities: rows(row.drive_target_campuses)
              .map(
                (c) => one<{ name?: string }>(one<{ cities?: unknown }>(c.campuses)?.cities)?.name,
              )
              .filter((name): name is string => typeof name === "string" && name !== ""),
            targetCampuses: linkedNames(row.drive_target_campuses, "campuses"),
          },
        };

        // The ids, not a `.length`. The card says "142 of 380 eligible
        // applied"; pressing either number opens those people.
        const eligibleStudents = contexts
          .filter((student) => isDriveVisibleToStudent(student, drive).visible)
          .map((student) => student.studentId);
        eligibleByDrive.set(driveId, eligibleStudents.length);

        const onThisDrive = appliedRows.filter((a) => a.drive_id === driveId);
        const offeredOnDrive = offerRows.filter((o) => o.drive_id === driveId);

        return {
          driveId,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? null,
          driveType: (row.drive_type as DriveType | null) ?? "placement",
          companyDriveId: (row.company_drive_id as string | null) ?? null,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          applicationStart: start,
          applicationEnd: end,
          eligible: eligibleStudents.length,
          eligibleStudentIds: eligibleStudents,
          applied: onThisDrive.length,
          appliedStudentIds: onThisDrive.map((a) => a.student_id as string),
          offers: offeredOnDrive.length,
          offerStudentIds: offeredOnDrive.map((o) => o.student_id as string),
        };
      });

      // R9 decides which offer is the student's placement, so the package
      // figures and the placed count can never disagree.
      const placements: PlacementCtc[] = [];
      for (const [studentId, held] of offersByStudent) {
        const record = resolvePlacementRecord(held);
        if (record === null) continue;
        // A placement record is a ladder offer, so it always carries a CTC.
        // If one ever does not, it is skipped rather than averaged as zero —
        // a zero in the package figures is the board-meeting number that is
        // wrong and looks deliberate (0070).
        if (record.ctcLpa === null) continue;
        placements.push({ studentId, ctcLpa: record.ctcLpa, category: record.offerCategory });
      }

      /**
       * Offers by category, as the students who hold them (2026-10-16).
       *
       * This counted offer ROWS, so a student with two Dream offers was two,
       * no popup could say who without inventing a row for them, and the
       * figure disagreed with the placed count and the package table beside it
       * — both of which read the one placement record per student (R9).
       */
      const studentIdsByCategory = new Map<string, string[]>();
      for (const placement of placements) {
        if (placement.category === null) continue;
        studentIdsByCategory.set(placement.category, [
          ...(studentIdsByCategory.get(placement.category) ?? []),
          placement.studentId,
        ]);
      }
      const offerCategories = [...studentIdsByCategory.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, studentIds]) => ({ category, studentIds }));

      // ------------------------------------------------- F5: per-drive progress
      const applicationsByDrive = new Map<string, string[]>();
      for (const row of appliedRows) {
        const driveId = row.drive_id as string;
        applicationsByDrive.set(driveId, [
          ...(applicationsByDrive.get(driveId) ?? []),
          row.id as string,
        ]);
      }

      const attendanceOf = new Map<string, AttendanceStatus>();
      for (const row of attendanceRows) {
        attendanceOf.set(
          `${row.round_id as string}:${row.application_id as string}`,
          (row.status as AttendanceStatus | null) ?? "scheduled",
        );
      }

      const resultOf = new Map<string, RoundResult>();
      for (const row of resultRows) {
        resultOf.set(
          `${row.round_id as string}:${row.application_id as string}`,
          row.result as RoundResult,
        );
      }

      /** Every application ANY shortlist row includes — the domain's rule. */
      const includedApplications = new Set(
        shortlistRows
          .filter((row) => row.included === true)
          .map((row) => row.application_id as string),
      );

      /**
       * Shortlist rows per application. `isShortlisted` reads ALL of them, so a
       * student the coordinator re-included after a withdrawal is not decided
       * by whichever row PostgREST happened to embed first.
       */
      const shortlistByApplication = new Map<string, Array<{ included: boolean | null }>>();
      for (const row of shortlistRows) {
        const appId = row.application_id as string;
        shortlistByApplication.set(appId, [
          ...(shortlistByApplication.get(appId) ?? []),
          { included: (row.included as boolean | null) ?? null },
        ]);
      }

      const studentMap = new Map<
        string,
        {
          fullName: string;
          rollNumber: string;
          campusId: string;
          campusName: string;
          degree?: string | undefined;
          branch?: string | undefined;
          cgpa?: number | undefined;
        }
      >();

      for (const row of cohortRows) {
        const campus = one<{ name?: string }>(row.campuses);
        studentMap.set(row.id as string, {
          fullName: (row.full_name as string | null) ?? "Unknown student",
          rollNumber: (row.roll_number as string | null) ?? "—",
          campusId: (row.campus_id as string | null) ?? "unknown",
          campusName: campus?.name ?? "Unassigned campus",
          degree: one<{ name?: string }>(row.degrees)?.name,
          branch: one<{ name?: string }>(row.branches)?.name,
          cgpa:
            row.overall_cgpa !== null && row.overall_cgpa !== undefined
              ? Number(row.overall_cgpa)
              : undefined,
        });
      }

      const studentIdByApp = new Map<string, string>();
      for (const row of appliedRows) {
        studentIdByApp.set(row.id as string, row.student_id as string);
      }

      const offerByStudentDrive = new Map<
        string,
        {
          ctcLpa: number | null;
          stipendMonthly?: number | null;
          driveType?: DriveType;
          offerCategory: string | null;
        }
      >();
      for (const o of offerRows) {
        offerByStudentDrive.set(`${o.student_id}:${o.drive_id}`, {
          ctcLpa: (o.ctc_lpa as number | null) === null ? null : Number(o.ctc_lpa),
          stipendMonthly: (o.stipend_monthly as number | null) ?? null,
          driveType: (o.drive_type as DriveType | null) ?? "placement",
          offerCategory: (o.offer_category as string | null) ?? null,
        });
      }

      /** Called to each round. Being called is the fact; attendance is what came after. */
      const participantsByRound = new Map<string, string[]>();
      for (const p of participantRows) {
        const roundId = p.round_id as string;
        participantsByRound.set(roundId, [
          ...(participantsByRound.get(roundId) ?? []),
          p.application_id as string,
        ]);
      }

      const driveProgress: DriveProgressSnapshot[] = driveRows.map((row) => {
        const driveId = row.id as string;
        const roleTitle = (row.role_title as string | null) ?? null;
        const company = (row.company_name as string | null) ?? "Unnamed drive";
        const applications = applicationsByDrive.get(driveId) ?? [];
        const applicationIds = new Set(applications);

        const driveRounds = roundRows
          .filter((round) => round.drive_id === driveId)
          .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));

        const driveStudents: DriveProgressStudentItem[] = applications
          .map((appId): DriveProgressStudentItem | null => {
            const studentId = studentIdByApp.get(appId);
            if (!studentId) return null;
            const student = studentMap.get(studentId);
            if (!student) return null;

            const studentRounds = driveRounds
              // Only the rounds they were called to are rows on their line —
              // the same fact `isShortlisted`/`inRounds` counts on the chips.
              .filter((round) =>
                (participantsByRound.get(round.id as string) ?? []).includes(appId),
              )
              .map((round) => {
                const roundId = round.id as string;
                const key = `${roundId}:${appId}`;
                return {
                  roundId,
                  sequence: Number(round.sequence ?? 0),
                  name: (round.name as string | null) ?? "Round",
                  attendance: attendanceOf.get(key) ?? "scheduled",
                  result: resultOf.get(key) ?? null,
                };
              });

            return {
              applicationId: appId,
              studentId,
              studentName: student.fullName,
              rollNumber: student.rollNumber,
              campusId: student.campusId,
              campusName: student.campusName,
              degree: student.degree,
              branch: student.branch,
              cgpa: student.cgpa,
              shortlisted: isShortlisted(shortlistByApplication.get(appId) ?? []),
              rounds: studentRounds,
              offer: offerByStudentDrive.get(`${studentId}:${driveId}`) ?? null,
            };
          })
          .filter((s): s is DriveProgressStudentItem => s !== null)
          .sort((a, b) => a.studentName.localeCompare(b.studentName));

        return {
          driveId,
          // Named for a human, because the filter above it is typed by one.
          driveName: roleTitle === null || roleTitle === "" ? company : `${company} — ${roleTitle}`,
          companyName: company,
          roleTitle,
          driveType: (row.drive_type as DriveType | null) ?? null,
          status: (row.status as string | null) ?? "draft",
          companyDriveId: (row.company_drive_id as string | null) ?? null,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          campusNames: linkedNames(row.drive_target_campuses, "campuses"),
          students: driveStudents,
          participation: {
            eligible: eligibleByDrive.get(driveId) ?? 0,
            applied: applications.length,
            shortlisted: applications.filter((id) => includedApplications.has(id)).length,
            offers: offerRows.filter((o) => o.drive_id === driveId).length,
            rounds: driveRounds.map((round) => {
              const roundId = round.id as string;
              return {
                roundId,
                sequence: Number(round.sequence ?? 0),
                name: (round.name as string | null) ?? "Round",
                participants: (participantsByRound.get(roundId) ?? [])
                  .filter((appId) => applicationIds.has(appId))
                  .map((appId): RoundParticipant => {
                    const key = `${roundId}:${appId}`;
                    return {
                      // The STUDENT, not the application the round keys on:
                      // the popup under a round's count lists people.
                      studentId: studentIdByApp.get(appId) ?? appId,
                      // No attendance row means the round has not happened
                      // to them yet. Reading that as an absence would put
                      // students on the R8 disbarment ladder for nothing.
                      attendance: attendanceOf.get(key) ?? "scheduled",
                      result: resultOf.get(key) ?? null,
                    };
                  }),
              };
            }),
          },
        };
      });

      return {
        students: cohortRows.map((row) => ({
          studentId: row.id as string,
          // 2026-10-16: the popup a count opens lists these. Before it, the
          // only thing a card could open was the whole directory.
          fullName: (row.full_name as string | null) ?? "Unknown student",
          rollNumber: (row.roll_number as string | null) ?? "—",
          degree: one<{ name?: string }>(row.degrees)?.name ?? "",
          branch: one<{ name?: string }>(row.branches)?.name ?? "",
          passingYear: Number(row.passing_year ?? 0),
          cgpa:
            row.overall_cgpa === null || row.overall_cgpa === undefined
              ? null
              : Number(row.overall_cgpa),
          participationStatus: (row.participation_status as ParticipationStatus) ?? "active",
          srfStatus: (row.srf_status as SrfStatus | null) ?? "invited",
          hasApplied: applied.has(row.id as string),
          hasOnCampusPlacement: onCampus.has(row.id as string),
          hasSelfPlacement: selfPlaced.has(row.id as string),
          // F4: the campus switcher filters on these, so every row carries
          // them. A student with no campus stays on the roster and is named
          // as unassigned rather than quietly dropped.
          campusId: (row.campus_id as string | null) ?? "unknown",
          campusName: one<{ name?: string }>(row.campuses)?.name ?? "Unassigned campus",
        })),
        driveProgress,
        placements,
        liveDrives,
        now: clock().toISOString(),
        drivesByStatus,
        statusDrives,
        offerCategories,
        campuses: [...campusTotals.values()].sort((a, b) =>
          a.campusName.localeCompare(b.campusName),
        ),
      };
    },
  };
}
