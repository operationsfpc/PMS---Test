import type { ApplicantRound } from "@domain/student-progress";
import type { AttendanceStatus, DriveStatus, RoundResult } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioApplicant, PortfolioDrive, PortfolioView } from "./portfolio-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * One round trip. The rounds and their three satellite tables are embedded
 * under the drive, and the applicants under it too, because a portfolio of ten
 * drives would otherwise be forty queries.
 *
 * `students(campuses(name))` is embedded rather than selected: an Account
 * Executive has no read policy on `students`, so PostgREST returns null there
 * and the applicant still appears - by name, from the snapshot. A Delivery
 * Head, who is an org reader, gets the campus.
 */
export const PORTFOLIO_DRIVE_COLUMNS = `
  id, company_name, role_title, status, on_hold, created_at,
  ctc_min_lpa, ctc_max_lpa,
  created_by, approved_by, published_by,
  application_start, application_end,
  drive_rounds(
    id, sequence, name,
    round_participants(application_id),
    round_results(application_id, result),
    attendance(application_id, status)
  ),
  applications(
    id, student_id, profile_snapshot,
    students(campuses(name)),
    shortlist_entries(included)
  )
`;

/**
 * The drives one person owns, assembled from live rows.
 *
 * Scope is RLS's decision and is deliberately not repeated here: an AE is
 * returned only the drives they raised, a Delivery Head sees the organisation.
 * Re-filtering by `created_by` in this file would be a second, weaker copy of
 * a rule the database already enforces.
 *
 * Applicant identity comes from `profile_snapshot` - the copy frozen at apply
 * time (PRD §7.3). Reading the live student row instead would rewrite history
 * on a drive already in progress, and an AE cannot read it at all.
 */
export function createSupabasePortfolioView(client: SupabaseClient): PortfolioView {
  return {
    async drives(): Promise<readonly PortfolioDrive[]> {
      const { data } = await client
        .from("drives")
        .select(PORTFOLIO_DRIVE_COLUMNS)
        .order("created_at", { ascending: false });

      const driveRows = rows(data);
      if (driveRows.length === 0) return [];

      const driveIds = driveRows.map((d) => d.id as string);
      const { data: offers } = await client
        .from("offers")
        .select("drive_id, student_id")
        .in("drive_id", driveIds);

      // An offer belongs to a student and a drive; an application is the same
      // pair. That pair is what ties the outcome back to the applicant.
      const won = new Set(
        rows(offers).map((o) => `${o.drive_id as string}::${o.student_id as string}`),
      );

      return driveRows.map((row): PortfolioDrive => {
        const driveId = row.id as string;

        const roundRows = rows(row.drive_rounds).sort(
          (a, b) => Number(a.sequence) - Number(b.sequence),
        );

        const applicants = rows(row.applications).map((application): PortfolioApplicant => {
          const applicationId = application.id as string;
          const snapshot = one<{ profile?: Record<string, unknown> }>(application.profile_snapshot);
          const profile = snapshot?.profile ?? {};

          const applicantRounds: ApplicantRound[] = roundRows.map((round) => {
            const participating = rows(round.round_participants).some(
              (p) => p.application_id === applicationId,
            );
            const result = rows(round.round_results).find(
              (r) => r.application_id === applicationId,
            );
            const attendance = rows(round.attendance).find(
              (a) => a.application_id === applicationId,
            );

            return {
              sequence: Number(round.sequence),
              name: (round.name as string | null) ?? "Round",
              participating,
              attendance: (attendance?.status as AttendanceStatus | undefined) ?? null,
              result: (result?.result as RoundResult | undefined) ?? null,
            };
          });

          const campus = one<{ campuses?: unknown }>(application.students);

          return {
            applicationId,
            studentName: (profile.fullName as string | undefined) ?? "Unnamed applicant",
            rollNumber: (profile.rollNumber as string | undefined) ?? "—",
            campus: one<{ name?: string }>(campus?.campuses)?.name ?? "—",
            shortlisted: rows(application.shortlist_entries).some((s) => s.included === true),
            hasOffer: won.has(`${driveId}::${application.student_id as string}`),
            rounds: applicantRounds,
          };
        });

        return {
          driveId,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? "Role not specified",
          status: (row.status as DriveStatus | null) ?? "draft",
          onHold: (row.on_hold as boolean | null) ?? false,
          // G5b: numerics arrive from PostgREST as strings.
          ctcMinLpa: row.ctc_min_lpa == null ? null : Number(row.ctc_min_lpa),
          ctcMaxLpa: row.ctc_max_lpa == null ? null : Number(row.ctc_max_lpa),
          createdBy: (row.created_by as string | null) ?? null,
          approvedBy: (row.approved_by as string | null) ?? null,
          publishedBy: (row.published_by as string | null) ?? null,
          // The list is ordered by this (2026-08-26), so it is carried rather
          // than only sorted on inside the query.
          createdAt: (row.created_at as string | null) ?? null,
          applicationStart: (row.application_start as string | null) ?? null,
          applicationEnd: (row.application_end as string | null) ?? null,
          totalRounds: roundRows.length,
          // A round counts as decided when a result has been declared in it -
          // not when it was merely scheduled or attended.
          roundsDecided: roundRows.filter((round) => rows(round.round_results).length > 0).length,
          applicants,
        };
      });
    },
  };
}
