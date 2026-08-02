import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import type { DriveStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ApprovalError extends Error {}

export interface PendingPif {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcMinLpa: number | null;
  readonly ctcMaxLpa: number | null;
  readonly driveType: string | null;
  readonly onHold: boolean;
  readonly createdAt: string | null;
}

export interface ApprovalRepository {
  pending(): Promise<readonly PendingPif[]>;
  decide(driveId: string, current: DriveStatus, decision: PifDecision): Promise<void>;
}

export type GetActorId = () => Promise<string | null>;

const COLUMNS =
  "id, company_name, role_title, ctc_min_lpa, ctc_max_lpa, drive_type, on_hold, created_at";

/**
 * The Delivery Head's queue.
 *
 * The decision itself belongs to `decidePif`: approving without an offer
 * category, or touching anything that is not awaiting approval, is refused
 * before it can reach the network. The database enforces the same rules again
 * (0004 has a check constraint requiring a reason on rejection) - this is the
 * near side of that pair, not a replacement for it.
 */
export function createSupabaseApprovalRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): ApprovalRepository {
  return {
    async pending() {
      const { data, error } = await client
        .from("drives")
        .select(COLUMNS)
        .eq("status", "submitted")
        .order("created_at", { ascending: true });

      if (error !== null) throw new ApprovalError("Could not load the approval queue.");

      return (data ?? []).map((row) => ({
        id: row.id as string,
        companyName: row.company_name as string,
        roleTitle: (row.role_title as string | null) ?? null,
        ctcMinLpa: (row.ctc_min_lpa as number | null) ?? null,
        ctcMaxLpa: (row.ctc_max_lpa as number | null) ?? null,
        driveType: (row.drive_type as string | null) ?? null,
        onHold: Boolean(row.on_hold),
        createdAt: (row.created_at as string | null) ?? null,
      }));
    },

    async decide(driveId, current, decision) {
      const outcome = decidePif(current, decision);
      if (!outcome.ok) throw new ApprovalError(outcome.error);

      const actorId = await getActorId();
      if (actorId === null) {
        throw new ApprovalError("Your session has expired. Please sign in again.");
      }

      const patch =
        decision.decision === "approve"
          ? {
              status: outcome.next,
              // Set here and never again: §3.3 makes it immutable.
              offer_category: decision.offerCategory,
              approved_by: actorId,
              approved_at: new Date().toISOString(),
            }
          : {
              status: outcome.next,
              rejection_reason: decision.reason,
              approved_by: actorId,
              approved_at: new Date().toISOString(),
            };

      const { error } = await client
        .from("drives")
        .update(patch)
        .eq("id", driveId)
        .select("id, status")
        .single();

      if (error !== null) {
        throw new ApprovalError("Could not save the decision. Please try again.");
      }
    },
  };
}
