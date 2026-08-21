import type { PickerDrive } from "@components/drive-picker";
import { describeCtcRange } from "@domain/ctc";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The drives the M1 picker lists — shared by Shortlisting, Rounds & results,
 * Attendance and Final selection (2026-08-21). Lives in `src/lib` because
 * four features need it and features may not import each other.
 *
 * "In progress" is deliberately the same set `drivesInProgress` used: a
 * completed drive's results are history, and a draft has nothing to run.
 */
const IN_PROGRESS_STATUSES = ["live", "applications_closed", "in_rounds"];

export async function fetchPickerDrives(client: SupabaseClient): Promise<readonly PickerDrive[]> {
  const { data, error } = await client
    .from("drives")
    .select("id, company_name, role_title, ctc_min_lpa, ctc_max_lpa, status, created_at")
    .in("status", IN_PROGRESS_STATUSES);

  if (error !== null) throw new Error("Could not list the drives. Please try again.");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    driveId: row.id as string,
    companyName: (row.company_name as string | null) ?? "Unnamed drive",
    roleTitle: (row.role_title as string | null) ?? null,
    ctcLabel: describeCtcRange(
      row.ctc_min_lpa == null ? null : Number(row.ctc_min_lpa),
      row.ctc_max_lpa == null ? null : Number(row.ctc_max_lpa),
    ),
    raisedOn: (row.created_at as string | null) ?? null,
    status: (row.status as string | null) ?? "draft",
  }));
}

export interface PickerRound {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
}

/** A drive's rounds for the attendance chooser — pick the drive, then the round. */
export async function fetchDriveRounds(
  client: SupabaseClient,
  driveId: string,
): Promise<readonly PickerRound[]> {
  const { data, error } = await client
    .from("drive_rounds")
    .select("id, sequence, name")
    .eq("drive_id", driveId)
    .order("sequence");

  if (error !== null) throw new Error("Could not read the drive's rounds.");

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      roundId: row.id as string,
      sequence: Number(row.sequence),
      name: (row.name as string | null) ?? `Round ${row.sequence}`,
    }))
    .sort((a, b) => a.sequence - b.sequence);
}
