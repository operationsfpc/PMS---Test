import type { PlacementCtc } from "@domain/ctc-statistics";
import { type Offer, resolvePlacementRecord } from "@domain/offers";
import type { DriveType, ParticipationStatus, SrfStatus } from "@domain/types";
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
        .select("id, participation_status, srf_status, campus_id, campuses(name)");

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
          : client.from("applications").select("student_id").in("student_id", studentIds),
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

      // R9 decides which offer is the student's placement, so the package
      // figures and the placed count can never disagree.
      const placements: PlacementCtc[] = [];
      for (const [studentId, held] of offersByStudent) {
        const record = resolvePlacementRecord(held);
        if (record === null) continue;
        placements.push({ studentId, ctcLpa: record.ctcLpa, category: record.offerCategory });
      }

      return {
        students: studentRows.map((row) => ({
          studentId: row.id as string,
          participationStatus: (row.participation_status as ParticipationStatus) ?? "active",
          srfStatus: (row.srf_status as SrfStatus | null) ?? "invited",
          hasApplied: applied.has(row.id as string),
          hasOnCampusPlacement: onCampus.has(row.id as string),
          hasSelfPlacement: selfPlaced.has(row.id as string),
        })),
        placements,
        drivesByStatus,
        offersByCategory,
        campuses: [...campusTotals.values()].sort((a, b) =>
          a.campusName.localeCompare(b.campusName),
        ),
      };
    },
  };
}
