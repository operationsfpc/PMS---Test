import type { ParticipationStatus, SrfStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two facts that decide where a student lands after signing in.
 *
 * Deliberately tiny and separate from the dashboard's own reader: this runs
 * on the critical path of every student login, and loading a dashboard's worth
 * of drives, applications and offers only to choose between two routes would
 * put a slow query in front of the form we are trying to get them to.
 */
export interface StudentStanding {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
}

export type ReadStudentStanding = () => Promise<StudentStanding | null>;

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const STUDENT_STANDING_COLUMNS = "srf_status, participation_status";

/**
 * Null - never a guess - when there is no session or no student row.
 *
 * The caller sends them to the dashboard in that case, which explains their
 * standing, rather than to a form that may be the wrong screen entirely.
 */
export function createSupabaseStudentStanding(client: SupabaseClient): ReadStudentStanding {
  return async () => {
    const { data: session } = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (userId === undefined) return null;

    const { data, error } = await client
      .from("students")
      .select(STUDENT_STANDING_COLUMNS)
      .eq("auth_user_id", userId)
      .maybeSingle();

    if (error !== null || data === null) return null;

    const row = data as unknown as Record<string, unknown>;

    return {
      srfStatus: row.srf_status as SrfStatus,
      participationStatus: (row.participation_status as ParticipationStatus | null) ?? "active",
    };
  };
}
