import type { OfferWithdrawal, ParticipationChange, StatusEvent } from "@domain/status-changes";
import { statusHistory } from "@domain/status-changes";
import type { DriveType, OfferSource, ParticipationStatus } from "@domain/types";
import { describeReadFailure, readAllRows } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";

export class StatusChangesError extends Error {}

/**
 * Who moved a student's standing, and why (0133, 0134).
 *
 * Written for the staff record that has to offer the two actions and show what
 * they did, and for the student's own screen, which reads the same two ledgers
 * and nothing else. Nothing here decides whether a change is allowed:
 * `restore_participation` and `withdraw_offer` do, under RLS, and a browser
 * check would be a suggestion. What this file does is refuse aloud — both RPCs
 * raise a sentence ("Only a Campus Placement Coordinator, a Campus Manager or a
 * Key Account Manager may return a student to the pipeline."), and the dialog
 * gets to show it rather than a spinner that stopped.
 */

/**
 * Aliased because the screens read the embed's value, not its relation: a
 * history line says who signed the change, and `changed_by` alone is a UUID.
 * Registered in src/db/query-contract.test.ts, which proves both against the
 * schema — these tables are new, so their column names are a guess until it says
 * otherwise.
 */
export const PARTICIPATION_CHANGE_COLUMNS =
  "id, from_status, to_status, reason, changed_at, changed_by:profiles(full_name)";

/** The pay fields are NOT top-level columns: 0134 snapshots the offer as jsonb. */
export const OFFER_WITHDRAWAL_COLUMNS =
  "id, company_name, role_title, source, reason, withdrawn_at, offer, " +
  "withdrawn_by:profiles(full_name)";

/** Supabase returns a to-one embed either as an object or a one-element array. */
const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const nameOf = (value: unknown) => one<{ full_name?: string }>(value)?.full_name ?? null;
/**
 * A numeric column out of PostgREST: a number, or a numeric string when the
 * driver kept the scale. `null` for anything that is not a figure at all,
 * because a history line must not invent one.
 */
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toChange = (row: Record<string, unknown>): ParticipationChange => ({
  id: row.id as string,
  fromStatus: row.from_status as ParticipationStatus,
  toStatus: row.to_status as ParticipationStatus,
  reason: (row.reason as string | null) ?? "",
  changedAt: row.changed_at as string,
  changedByName: nameOf(row.changed_by),
});

const toWithdrawal = (row: Record<string, unknown>): OfferWithdrawal => {
  const offer = one<Record<string, unknown>>(row.offer) ?? {};
  return {
    id: row.id as string,
    companyName: (row.company_name as string | null) ?? "Company not recorded",
    roleTitle: (row.role_title as string | null) ?? null,
    source: row.source as OfferSource,
    driveType: (offer.drive_type as DriveType | undefined) ?? "placement",
    ctcLpa: num(offer.ctc_lpa) ?? 0,
    stipendMonthly: num(offer.stipend_monthly),
    reason: (row.reason as string | null) ?? "",
    withdrawnAt: row.withdrawn_at as string,
    withdrawnByName: nameOf(row.withdrawn_by),
  };
};

/** A write the database refuses must say why (holds-view's rule). */
const withDetail = (summary: string, error: { message?: string }): StatusChangesError =>
  new StatusChangesError(
    typeof error.message === "string" && error.message.trim() !== ""
      ? `${summary} (${error.message})`
      : summary,
  );

export interface StatusChangesView {
  /**
   * Both ledgers for one student, newest first.
   *
   * A failed read throws rather than answering "nothing has ever happened to
   * this student" — an empty list and a refused list look identical on screen,
   * and one of them is a lie.
   */
  historyFor(studentId: string): Promise<StatusEvent[]>;
  /** opted_out -> active, with the reason the student is shown (0133). */
  restore(studentId: string, reason: string): Promise<void>;
  /** Removes an offer and archives it, with the reason (0134). */
  withdraw(offerId: string, reason: string): Promise<void>;
}

export function createSupabaseStatusChangesView(client: SupabaseClient): StatusChangesView {
  return {
    async historyFor(studentId) {
      let changeRows: Array<Record<string, unknown>>;
      let withdrawalRows: Array<Record<string, unknown>>;
      try {
        [changeRows, withdrawalRows] = await Promise.all([
          readAllRows((from, to) =>
            client
              .from("participation_status_changes")
              .select(PARTICIPATION_CHANGE_COLUMNS)
              .eq("student_id", studentId)
              .order("changed_at", { ascending: false })
              .range(from, to),
          ),
          readAllRows((from, to) =>
            client
              .from("offer_withdrawals")
              .select(OFFER_WITHDRAWAL_COLUMNS)
              .eq("student_id", studentId)
              .order("withdrawn_at", { ascending: false })
              .range(from, to),
          ),
        ]);
      } catch (cause) {
        throw new StatusChangesError(
          describeReadFailure(cause, "Could not read this student's status history."),
        );
      }
      return statusHistory(changeRows.map(toChange), withdrawalRows.map(toWithdrawal));
    },

    async restore(studentId, reason) {
      const { error } = await client.rpc("restore_participation", {
        p_student_id: studentId,
        p_reason: reason.trim(),
      });

      if (error !== null) {
        throw withDetail("The student was not returned to the pipeline.", error);
      }
    },

    async withdraw(offerId, reason) {
      const { error } = await client.rpc("withdraw_offer", {
        p_offer_id: offerId,
        p_reason: reason.trim(),
      });

      if (error !== null) throw withDetail("The offer was not withdrawn.", error);
    },
  };
}
