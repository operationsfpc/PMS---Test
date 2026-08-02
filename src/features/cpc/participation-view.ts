import { canApproveParticipationChange } from "@domain/participation";
import type { AppRole } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipationQueueView } from "./participation-queue";

export class ParticipationQueueError extends Error {}

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Opt-out and self-placement approvals, against live data.
 *
 * Approving an opt-out flips participation_status, which 0009's
 * enforce_opt_out_irreversible then locks forever. Approving a self-placement
 * is what finally creates the `offers` row - source 'self_placed', so R3, R4
 * and R9 continue to ignore it.
 */
export function createSupabaseParticipationQueueView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): ParticipationQueueView {
  async function approver() {
    const decision = canApproveParticipationChange(await getActorRole());
    if (!decision.allowed) throw new ParticipationQueueError(decision.reason);

    const id = await getActorId();
    if (id === null) {
      throw new ParticipationQueueError("Your session has expired. Please sign in again.");
    }
    return id;
  }

  return {
    async pending() {
      const [{ data: optOuts }, { data: placements }] = await Promise.all([
        client
          .from("opt_out_requests")
          .select("id, reason, students(full_name, roll_number)")
          .eq("status", "pending"),
        client
          .from("self_placement_requests")
          .select("id, company_name, ctc_lpa, students(full_name, roll_number)")
          .eq("status", "pending"),
      ]);

      const name = (row: Record<string, unknown>) =>
        one<{ full_name?: string; roll_number?: string }>(row.students);

      return {
        optOuts: (optOuts ?? []).map((row) => {
          const student = name(row);
          return {
            id: row.id as string,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            reason: (row.reason as string | null) ?? "",
          };
        }),
        selfPlacements: (placements ?? []).map((row) => {
          const student = name(row);
          return {
            id: row.id as string,
            studentName: student?.full_name ?? "Unknown student",
            rollNumber: student?.roll_number ?? "—",
            companyName: (row.company_name as string | null) ?? "Unknown company",
            ctcLpa: (row.ctc_lpa as number | null) ?? 0,
          };
        }),
      };
    },

    async approveOptOut(requestId) {
      const actorId = await approver();

      const { data, error } = await client
        .from("opt_out_requests")
        .update({ status: "verified", decided_by: actorId, decided_at: new Date().toISOString() })
        .eq("id", requestId)
        .select("student_id")
        .single();

      if (error !== null || data === null) {
        throw new ParticipationQueueError("Could not approve the request.");
      }

      // Irreversible from here: 0009 refuses any move away from opted_out.
      const { error: studentError } = await client
        .from("students")
        .update({ participation_status: "opted_out" })
        .eq("id", data.student_id as string)
        .select("id")
        .single();

      if (studentError !== null) {
        throw new ParticipationQueueError(
          "The request was approved but the student's status did not change. Please retry.",
        );
      }
    },

    async rejectOptOut(requestId) {
      const actorId = await approver();

      const { error } = await client
        .from("opt_out_requests")
        .update({ status: "rejected", decided_by: actorId, decided_at: new Date().toISOString() })
        .eq("id", requestId)
        .select("id")
        .single();

      if (error !== null) throw new ParticipationQueueError("Could not reject the request.");
    },

    async approveSelfPlacement(requestId) {
      const actorId = await approver();
      const now = new Date().toISOString();

      const { data, error } = await client
        .from("self_placement_requests")
        .update({ status: "verified", decided_by: actorId, decided_at: now })
        .eq("id", requestId)
        .select("student_id, company_name, role_title, ctc_lpa")
        .single();

      if (error !== null || data === null) {
        throw new ParticipationQueueError("Could not approve the offer.");
      }

      const { error: offerError } = await client
        .from("offers")
        .insert({
          student_id: data.student_id as string,
          drive_id: null,
          source: "self_placed",
          company_name: data.company_name as string,
          role_title: (data.role_title as string | null) ?? null,
          drive_type: "placement",
          offer_category: null,
          ctc_lpa: data.ctc_lpa as number,
          declared_by: actorId,
          approved_by: actorId,
          approved_at: now,
        })
        .select("id")
        .single();

      if (offerError !== null) {
        throw new ParticipationQueueError(
          "The request was approved but the offer was not recorded. Please retry.",
        );
      }
    },
  };
}
