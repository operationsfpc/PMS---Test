import {
  canApproveParticipationChange,
  canDeclineParticipationRequest,
} from "@domain/participation";
import type { AppRole } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipationQueueView } from "./participation-queue-contract";

export class ParticipationQueueError extends Error {}

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/** Long enough to read a document, short enough not to be worth sharing. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * A short-lived link to a document (PRD §21.2 - nothing is public).
 *
 * `storage_path` carries the bucket, because the two kinds of evidence live in
 * different ones. A path we cannot sign returns null so the screen can say so:
 * a coordinator must never believe they have checked something they could not
 * open.
 */
async function signedUrlFor(
  client: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (storagePath === null || storagePath === undefined || storagePath === "") return null;

  const [bucket, ...rest] = storagePath.split("/");
  if (bucket === undefined || rest.length === 0) return null;

  const { data } = await client.storage
    .from(bucket)
    .createSignedUrl(rest.join("/"), SIGNED_URL_TTL_SECONDS);

  return data?.signedUrl ?? null;
}

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

  /**
   * F1: the decline is refused HERE if the reason is not one, before anything
   * is written. 0032 refuses it again in the database, and both quote the
   * domain, so the coordinator is told the same thing either way.
   */
  async function decliner(reason: string) {
    const decision = canDeclineParticipationRequest(await getActorRole(), reason);
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
          .select("id, reason, students(full_name, roll_number), student_documents(storage_path)")
          .eq("status", "pending"),
        client
          .from("self_placement_requests")
          .select(
            "id, company_name, ctc_lpa, students(full_name, roll_number), student_documents(storage_path)",
          )
          .eq("status", "pending"),
      ]);

      const name = (row: Record<string, unknown>) =>
        one<{ full_name?: string; roll_number?: string }>(row.students);

      const evidenceOf = (row: Record<string, unknown>) =>
        one<{ storage_path?: string }>(row.student_documents)?.storage_path;

      return {
        optOuts: await Promise.all(
          (optOuts ?? []).map(async (row) => {
            const student = name(row);
            return {
              id: row.id as string,
              studentName: student?.full_name ?? "Unknown student",
              rollNumber: student?.roll_number ?? "—",
              reason: (row.reason as string | null) ?? "",
              declarationUrl: await signedUrlFor(client, evidenceOf(row)),
            };
          }),
        ),
        selfPlacements: await Promise.all(
          (placements ?? []).map(async (row) => {
            const student = name(row);
            return {
              id: row.id as string,
              studentName: student?.full_name ?? "Unknown student",
              rollNumber: student?.roll_number ?? "—",
              companyName: (row.company_name as string | null) ?? "Unknown company",
              ctcLpa: (row.ctc_lpa as number | null) ?? 0,
              offerLetterUrl: await signedUrlFor(client, evidenceOf(row)),
            };
          }),
        ),
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

    async declineOptOut(requestId, reason) {
      const actorId = await decliner(reason);

      const { error } = await client
        .from("opt_out_requests")
        .update({
          status: "rejected",
          decided_by: actorId,
          decided_at: new Date().toISOString(),
          decision_reason: reason.trim(),
        })
        .eq("id", requestId)
        .select("id")
        .single();

      if (error !== null) throw new ParticipationQueueError("Could not decline the request.");
    },

    /**
     * Nothing is created. The student keeps the ability to record another
     * offer, which is the point: they were told what was wrong with the first.
     */
    async declineSelfPlacement(requestId, reason) {
      const actorId = await decliner(reason);

      const { error } = await client
        .from("self_placement_requests")
        .update({
          status: "rejected",
          decided_by: actorId,
          decided_at: new Date().toISOString(),
          decision_reason: reason.trim(),
        })
        .eq("id", requestId)
        .select("id")
        .single();

      if (error !== null) throw new ParticipationQueueError("Could not decline the offer.");
    },

    async approveSelfPlacement(requestId, classification) {
      // D6: a job offer with no rung would climb the ladder and block nothing.
      // Refused before anything is written, so a half-approved request cannot
      // exist.
      if (classification.driveType === "placement" && classification.offerCategory === null) {
        throw new ParticipationQueueError(
          "Select the offer category before approving — it decides which drives stay open to this student.",
        );
      }

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
          drive_type: classification.driveType,
          offer_category:
            classification.driveType === "internship" ? null : classification.offerCategory,
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
