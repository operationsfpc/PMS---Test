import type { SupabaseClient } from "@supabase/supabase-js";
import type { AeOverviewDrive, AeOverviewSnapshot, AeOverviewView } from "./overview-page";

/**
 * Feeds the Account Executive's landing page (approved 2026-08-26, option A).
 *
 * Their drives come back from `drives` — RLS returns only the ones they
 * raised, so nothing here filters on `created_by`: a filter in the browser is
 * a suggestion, and the database is the thing that actually refuses.
 *
 * The organisation's figures come from `placement_totals()` (0064), never from
 * `students`. That is the whole of option A: an AE quotes the organisation's
 * numbers and cannot read a single student record.
 */
export class AeOverviewError extends Error {}

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

/** PostgREST returns numerics as strings; a count as a string sorts wrong and adds wrong. */
const num = (value: unknown): number => Number(value ?? 0);
const orNull = (value: unknown): number | null => (value == null ? null : Number(value));

/**
 * Exported so src/db/query-contract.test.ts can prove it against the real schema.
 *
 * `shortlist_entries` is embedded because the AE's own count of who was sent
 * to the recruiter is the point of the card; `0019` is what lets them read it.
 */
export const AE_OVERVIEW_DRIVE_COLUMNS = `
  id, company_name, role_title, status, ctc_min_lpa, ctc_max_lpa, created_at,
  applications(id, student_id, shortlist_entries(included))
`;

export function createSupabaseAeOverviewView(client: SupabaseClient): AeOverviewView {
  return {
    async snapshot(): Promise<AeOverviewSnapshot> {
      const [{ data: driveRows }, { data: totalRows, error: totalsError }] = await Promise.all([
        client.from("drives").select(AE_OVERVIEW_DRIVE_COLUMNS),
        client.rpc("placement_totals"),
      ]);

      // A refused or missing aggregate must never be read as an organisation
      // with no students: that would put a confident 0% in front of a client.
      if (totalsError !== null || totalRows == null) {
        throw new AeOverviewError("Could not read the placement figures.");
      }

      const driveIds = rows(driveRows).map((d) => d.id as string);
      const { data: offerRows } =
        driveIds.length === 0
          ? { data: [] }
          : await client.from("offers").select("drive_id, student_id").in("drive_id", driveIds);

      // An offer belongs to a student and a drive; an application is the same
      // pair. That pair is what ties the outcome back to the applicant.
      const won = new Set(
        rows(offerRows).map((o) => `${o.drive_id as string}::${o.student_id as string}`),
      );

      const drives = rows(driveRows).map((row): AeOverviewDrive => {
        const driveId = row.id as string;
        return {
          driveId,
          companyName: (row.company_name as string | null) ?? "Unnamed drive",
          roleTitle: (row.role_title as string | null) ?? null,
          status: (row.status as AeOverviewDrive["status"] | null) ?? "draft",
          ctcMinLpa: orNull(row.ctc_min_lpa),
          ctcMaxLpa: orNull(row.ctc_max_lpa),
          createdAt: (row.created_at as string | null) ?? null,
          applicants: rows(row.applications).map((application) => ({
            shortlisted: rows(application.shortlist_entries).some((s) => s.included === true),
            hasOffer: won.has(`${driveId}::${application.student_id as string}`),
          })),
        };
      });

      const totals = (Array.isArray(totalRows) ? totalRows[0] : totalRows) as Record<
        string,
        unknown
      >;

      return {
        drives,
        totals: {
          eligible: num(totals.eligible),
          placed: num(totals.placed),
          selfPlaced: num(totals.self_placed),
          optedOut: num(totals.opted_out),
          completedDrives: num(totals.completed_drives),
          // Null rather than 0 when nobody is placed: zero is a real CTC.
          highestLpa: orNull(totals.highest_lpa),
          lowestLpa: orNull(totals.lowest_lpa),
          averageLpa: orNull(totals.average_lpa),
          medianLpa: orNull(totals.median_lpa),
        },
      };
    },
  };
}
