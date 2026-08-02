import type { ParticipationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampusBreakdown, DashboardSnapshot, DashboardView } from "./dashboard-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

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
): DashboardView {
  return {
    async snapshot(): Promise<DashboardSnapshot> {
      const studentQuery = client
        .from("students")
        .select("id, participation_status, campus_id, campuses(name)");

      const { data: students } =
        campusIds === undefined || campusIds.length === 0
          ? await studentQuery
          : await studentQuery.in("campus_id", campusIds);

      const studentRows = (students ?? []) as Array<Record<string, unknown>>;
      const studentIds = studentRows.map((s) => s.id as string);

      const [{ data: offers }, { data: drives }] = await Promise.all([
        studentIds.length === 0
          ? Promise.resolve({ data: [] })
          : client
              .from("offers")
              .select("student_id, source, drive_type, offer_category")
              .in("student_id", studentIds),
        client.from("drives").select("status"),
      ]);

      const onCampus = new Set<string>();
      const selfPlaced = new Set<string>();
      const offersByCategory: Record<string, number> = {};

      for (const offer of (offers ?? []) as Array<Record<string, unknown>>) {
        const studentId = offer.student_id as string;

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

      return {
        students: studentRows.map((row) => ({
          studentId: row.id as string,
          participationStatus: (row.participation_status as ParticipationStatus) ?? "active",
          hasOnCampusPlacement: onCampus.has(row.id as string),
          hasSelfPlacement: selfPlaced.has(row.id as string),
        })),
        drivesByStatus,
        offersByCategory,
        campuses: [...campusTotals.values()].sort((a, b) =>
          a.campusName.localeCompare(b.campusName),
        ),
      };
    },
  };
}
