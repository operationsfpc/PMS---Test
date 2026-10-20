import type { ApplicantRound } from "@domain/student-progress";
import type { AttendanceStatus, DriveStatus, DriveType, RoundResult } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioApplicant, PortfolioDrive, PortfolioView } from "./portfolio-page";

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * Only the round LIST is embedded. A drive has a handful of rounds and each
 * round has a participant row per applicant, so embedding those three
 * satellites capped them at 1000 rows for the whole portfolio — an applicant
 * whose row fell past the cap printed as "did not sit the round". Rounds and
 * applications are read as their own paged queries below.
 *
 * `students(campuses(name))` stays embedded rather than selected: an Account
 * Executive has no read policy on `students`, so PostgREST returns null there
 * and the applicant still appears - by name, from the snapshot. A Delivery
 * Head, who is an org reader, gets the campus.
 */
export const PORTFOLIO_DRIVE_COLUMNS = `
  id, company_name, role_title, status, on_hold, created_at,
  ctc_min_lpa, ctc_max_lpa, drive_type,
  created_by, approved_by, published_by,
  application_start, application_end,
  tentative_date, openings, company_drive_id,
  drive_rounds(id, sequence, name)
`;

/** Exported for the same reason. */
export const PORTFOLIO_APPLICATION_COLUMNS =
  "id, drive_id, student_id, profile_snapshot, students(campuses(name)), shortlist_entries(included)";

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
      // Paged, with every error raised. This used to discard `{ error }` and
      // answer `null`, so a refused read greeted an Account Executive with
      // forty live drives with "No drives yet".
      const driveRows = await readAllRows((from, to) =>
        client
          .from("drives")
          .select(PORTFOLIO_DRIVE_COLUMNS)
          .order("created_at", { ascending: false })
          .range(from, to),
      );
      if (driveRows.length === 0) return [];

      const driveIds = driveRows.map((d) => d.id as string);
      const applicationRows = await readAllRowsByIds(
        driveIds,
        (batch) => (from, to) =>
          client
            .from("applications")
            .select(PORTFOLIO_APPLICATION_COLUMNS)
            .in("drive_id", batch)
            .range(from, to),
      );

      const roundIds = driveRows.flatMap((d) => rows(d.drive_rounds).map((r) => r.id as string));

      /**
       * Batched by id, and paged within each batch, because a long `in(...)`
       * list is refused by the gateway and comes back as an EMPTY list rather
       * than an error. The offers read below used to be one such URL over every
       * drive the owner has: refused, and every applicant on the portfolio
       * showed "no offer" — the ones who had one included.
       */
      const [participantRows, resultRows, attendanceRows, offerRows] = await Promise.all([
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
        readAllRowsByIds(
          driveIds,
          (batch) => (from, to) =>
            client
              .from("offers")
              .select("drive_id, student_id")
              .in("drive_id", batch)
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
      const decidedRounds = new Set(resultRows.map((r) => r.round_id as string));

      // An offer belongs to a student and a drive; an application is the same
      // pair. That pair is what ties the outcome back to the applicant.
      const won = new Set(
        offerRows.map((o) => `${o.drive_id as string}::${o.student_id as string}`),
      );

      const applicantsByDrive = new Map<string, Array<Record<string, unknown>>>();
      for (const application of applicationRows) {
        const driveId = application.drive_id as string;
        const list = applicantsByDrive.get(driveId) ?? [];
        list.push(application);
        applicantsByDrive.set(driveId, list);
      }

      return driveRows.map((row): PortfolioDrive => {
        const driveId = row.id as string;

        const roundRows = rows(row.drive_rounds).sort(
          (a, b) => Number(a.sequence) - Number(b.sequence),
        );

        const applicants = (applicantsByDrive.get(driveId) ?? []).map(
          (application): PortfolioApplicant => {
            const applicationId = application.id as string;
            const snapshot = one<{ profile?: Record<string, unknown> }>(
              application.profile_snapshot,
            );
            const profile = snapshot?.profile ?? {};

            const applicantRounds: ApplicantRound[] = roundRows.map((round) => {
              const at = pair(round.id, applicationId);

              return {
                sequence: Number(round.sequence),
                name: (round.name as string | null) ?? "Round",
                participating: scheduled.has(at),
                attendance: presentAt.get(at) ?? null,
                result: resultAt.get(at) ?? null,
              };
            });

            const campus = one<{ campuses?: unknown }>(application.students);

            return {
              applicationId,
              studentId: application.student_id as string,
              studentName: (profile.fullName as string | undefined) ?? "Unnamed applicant",
              rollNumber: (profile.rollNumber as string | undefined) ?? "—",
              campus: one<{ name?: string }>(campus?.campuses)?.name ?? "—",
              shortlisted: rows(application.shortlist_entries).some((s) => s.included === true),
              hasOffer: won.has(`${driveId}::${application.student_id as string}`),
              rounds: applicantRounds,
            };
          },
        );

        return {
          driveId,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? "Role not specified",
          status: (row.status as DriveStatus | null) ?? "draft",
          onHold: (row.on_hold as boolean | null) ?? false,
          // G5b: numerics arrive from PostgREST as strings.
          ctcMinLpa: row.ctc_min_lpa == null ? null : Number(row.ctc_min_lpa),
          ctcMaxLpa: row.ctc_max_lpa == null ? null : Number(row.ctc_max_lpa),
          // 2026-08-27: filtered on, and tagged on every card. Null is a
          // drive that never declared one, and stays null rather than
          // defaulting into a bucket the data never named.
          driveType: (row.drive_type as DriveType | null) ?? null,
          createdBy: (row.created_by as string | null) ?? null,
          approvedBy: (row.approved_by as string | null) ?? null,
          publishedBy: (row.published_by as string | null) ?? null,
          // The list is ordered by this (2026-08-26), so it is carried rather
          // than only sorted on inside the query.
          createdAt: (row.created_at as string | null) ?? null,
          applicationStart: (row.application_start as string | null) ?? null,
          applicationEnd: (row.application_end as string | null) ?? null,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          openings: row.openings == null ? null : Number(row.openings),
          companyDriveId: (row.company_drive_id as string | null) ?? null,
          totalRounds: roundRows.length,
          // A round counts as decided when a result has been declared in it -
          // not when it was merely scheduled or attended.
          roundsDecided: roundRows.filter((round) => decidedRounds.has(round.id as string)).length,
          applicants,
        };
      });
    },
  };
}
