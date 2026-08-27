import type { PlacementCtc } from "@domain/ctc-statistics";
import type { RoundParticipant } from "@domain/drive-funnel";
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
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CampusBreakdown,
  DashboardSnapshot,
  DashboardView,
  DriveProgressSnapshot,
  LiveDrive,
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
 */
export const DASHBOARD_DRIVE_BOX_COLUMNS = `
  id, company_name, role_title, status,
  drive_target_campuses(campuses(name))
`;

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const DASHBOARD_COHORT_COLUMNS = `
  id, participation_status, srf_status, campus_id, passing_year,
  overall_cgpa, tenth_percentage, twelfth_percentage,
  current_arrears, history_of_arrears,
  degrees(name), branches(name), campuses(name, cities(name))
`;

/** Drive types that count as an on-campus PLACEMENT. An internship is not one. */
const PLACEMENT_TYPES = new Set(["placement", "internship_convertible"]);

/**
 * Feeds every dashboard.
 *
 * It gathers facts and nothing else: which students exist, and which of them
 * hold which kind of offer. Every judgement - who counts, what a placement is,
 * what the rate is - belongs to src/domain/statistics.ts.
 *
 * Optionally scoped to a set of campuses, which is how a Campus Manager sees
 * only theirs while a CEO sees everything.
 */
export function createSupabaseDashboardView(
  client: SupabaseClient,
  campusIds?: readonly string[],
  /** Injected so the drive clock is testable; never read inside a component. */
  clock: () => Date = () => new Date(),
): DashboardView {
  return {
    async snapshot(): Promise<DashboardSnapshot> {
      const studentQuery = client.from("students").select(DASHBOARD_COHORT_COLUMNS);

      const { data: students } =
        campusIds === undefined || campusIds.length === 0
          ? await studentQuery
          : await studentQuery.in("campus_id", campusIds);

      const studentRows = (students ?? []) as Array<Record<string, unknown>>;
      const studentIds = studentRows.map((s) => s.id as string);

      const [{ data: offers }, { data: drives }, { data: applications }] = await Promise.all([
        studentIds.length === 0
          ? Promise.resolve({ data: [] })
          : client
              .from("offers")
              .select(
                "id, student_id, drive_id, source, drive_type, offer_category, ctc_lpa, declared_at",
              )
              .in("student_id", studentIds),
        client.from("drives").select("status"),
        studentIds.length === 0
          ? Promise.resolve({ data: [] })
          : // `id` is not decoration: the drive box counts shortlist entries
            // and round participants, both of which key on the APPLICATION.
            client
              .from("applications")
              .select("id, student_id, drive_id")
              .in("student_id", studentIds),
      ]);

      const { data: openDrives } = await client
        .from("drives")
        .select(DASHBOARD_LIVE_DRIVE_COLUMNS)
        .eq("status", "live");

      // F5: the drive-specific box. Read for EVERY drive, not just the live
      // ones - a drive in its rounds is exactly the one a coordinator is
      // chasing, and it is no longer open for applications.
      const { data: allDrives } = await client.from("drives").select(DASHBOARD_DRIVE_BOX_COLUMNS);

      const [
        { data: rounds },
        { data: participants },
        { data: marks },
        { data: outcomes },
        { data: shortlisted },
      ] = await Promise.all([
        client.from("drive_rounds").select("id, drive_id, sequence, name"),
        client.from("round_participants").select("round_id, application_id"),
        client.from("attendance").select("round_id, application_id, status"),
        client.from("round_results").select("round_id, application_id, result"),
        client.from("shortlist_entries").select("application_id, included"),
      ]);

      const onCampus = new Set<string>();
      const selfPlaced = new Set<string>();
      const offersByCategory: Record<string, number> = {};

      // Kept per student so R9 can pick the ONE offer that is their placement
      // record. Averaging every row instead would count a student holding three
      // offers three times and inflate the package.
      const offersByStudent = new Map<string, Offer[]>();

      const applied = new Set(
        ((applications ?? []) as Array<Record<string, unknown>>).map((a) => a.student_id as string),
      );

      for (const offer of (offers ?? []) as Array<Record<string, unknown>>) {
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

        const category = offer.offer_category as string | null;
        if (category !== null) {
          offersByCategory[category] = (offersByCategory[category] ?? 0) + 1;
        }
      }

      const drivesByStatus: Record<string, number> = {};
      for (const drive of (drives ?? []) as Array<Record<string, unknown>>) {
        const status = drive.status as string;
        drivesByStatus[status] = (drivesByStatus[status] ?? 0) + 1;
      }

      // Per-campus counts use the same definitions, so a campus row can never
      // disagree with the headline.
      const campusTotals = new Map<string, CampusBreakdown>();
      for (const row of studentRows) {
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
       * Run over the students this viewer can read, so a Campus Manager's
       * eligible count is their campus - the same scoping as every other
       * figure on the screen.
       */
      const contexts = studentRows.map((row) => {
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
          srfStatus: (row.srf_status as SrfStatus | null) ?? "invited",
          participationStatus: (row.participation_status as ParticipationStatus) ?? "active",
          academics,
          offers: offersByStudent.get(row.id as string) ?? [],
        };
      });

      const appliedRows = (applications ?? []) as Array<Record<string, unknown>>;
      const offerRows = (offers ?? []) as Array<Record<string, unknown>>;

      // Reused by the drive box, so "eligible" means the same R5 number in
      // both places on the screen.
      const eligibleByDrive = new Map<string, number>();

      const liveDrives: LiveDrive[] = rows(openDrives).map((row): LiveDrive => {
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

        const eligible = contexts.filter(
          (student) => isDriveVisibleToStudent(student, drive).visible,
        ).length;
        eligibleByDrive.set(driveId, eligible);

        return {
          driveId,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? null,
          applicationStart: start,
          applicationEnd: end,
          eligible,
          applied: appliedRows.filter((a) => a.drive_id === driveId).length,
          offers: offerRows.filter((o) => o.drive_id === driveId).length,
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
      for (const row of rows(marks)) {
        attendanceOf.set(
          `${row.round_id as string}:${row.application_id as string}`,
          (row.status as AttendanceStatus | null) ?? "scheduled",
        );
      }

      const resultOf = new Map<string, RoundResult>();
      for (const row of rows(outcomes)) {
        resultOf.set(
          `${row.round_id as string}:${row.application_id as string}`,
          row.result as RoundResult,
        );
      }

      const includedApplications = new Set(
        rows(shortlisted)
          .filter((row) => row.included === true)
          .map((row) => row.application_id as string),
      );

      const driveProgress: DriveProgressSnapshot[] = rows(allDrives).map((row) => {
        const driveId = row.id as string;
        const roleTitle = (row.role_title as string | null) ?? null;
        const company = (row.company_name as string | null) ?? "Unnamed drive";
        const applications = applicationsByDrive.get(driveId) ?? [];
        const applicationIds = new Set(applications);

        return {
          driveId,
          // Named for a human, because the filter above it is typed by one.
          driveName: roleTitle === null || roleTitle === "" ? company : `${company} — ${roleTitle}`,
          campusNames: linkedNames(row.drive_target_campuses, "campuses"),
          participation: {
            eligible: eligibleByDrive.get(driveId) ?? 0,
            applied: applications.length,
            shortlisted: applications.filter((id) => includedApplications.has(id)).length,
            offers: offerRows.filter((o) => o.drive_id === driveId).length,
            rounds: rows(rounds)
              .filter((round) => round.drive_id === driveId)
              .map((round) => {
                const roundId = round.id as string;
                return {
                  roundId,
                  sequence: Number(round.sequence ?? 0),
                  name: (round.name as string | null) ?? "Round",
                  participants: rows(participants)
                    .filter(
                      (p) =>
                        p.round_id === roundId && applicationIds.has(p.application_id as string),
                    )
                    .map((p): RoundParticipant => {
                      const key = `${roundId}:${p.application_id as string}`;
                      return {
                        studentId: p.application_id as string,
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
        students: studentRows.map((row) => ({
          studentId: row.id as string,
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
        offersByCategory,
        campuses: [...campusTotals.values()].sort((a, b) =>
          a.campusName.localeCompare(b.campusName),
        ),
      };
    },
  };
}
