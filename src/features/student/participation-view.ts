import { holdDraftProblem } from "@domain/holds";
import {
  canRecordSelfPlacement,
  canRequestOptOut,
  canRequestSelfPlacedHold,
  optOutReasonProblem,
} from "@domain/participation";
import { sanitizeStorageFileName } from "@domain/storage-path";
import type { ParticipationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasPendingRequest,
  type ParticipationView,
  type RequestStatus,
} from "./participation-contract";

export class ParticipationError extends Error {}

/** Where each kind of evidence lives. Both buckets are private (0010, 0022). */
const BUCKETS = {
  offer_letter: "offer-letters",
  opt_out_declaration: "declarations",
  // The same declarations bucket as an opt-out: handwritten, photographed, and
  // read by staff through 0022's shared policy. 0130 adds the kind label.
  self_placement_declaration: "declarations",
} as const;

/**
 * Stores one piece of evidence and records it against the student.
 *
 * Objects are namespaced by student id - `<student>/<name>` - because that is
 * exactly what the storage policy checks: a student may only ever write inside
 * their own folder.
 *
 * The file is uploaded BEFORE the request row is written, and a failure throws
 * rather than continuing. A request with no evidence is what the database now
 * refuses, and a student who was told their opt-out was sent when it was not
 * is the worst possible outcome here.
 */
async function uploadEvidence(
  client: SupabaseClient,
  studentId: string,
  kind: keyof typeof BUCKETS,
  file: File,
): Promise<string> {
  // The name is prefixed so re-uploading never collides with an earlier one;
  // storage_path is unique, and a student correcting a bad photo is normal.
  const path = `${studentId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;

  const { error: uploadError } = await client.storage
    .from(BUCKETS[kind])
    .upload(path, file, { contentType: file.type });

  if (uploadError !== null) {
    throw new ParticipationError(
      "Could not upload your document. Check your connection and try again.",
    );
  }

  const { data, error } = await client
    .from("student_documents")
    .insert({
      student_id: studentId,
      kind,
      storage_path: path,
      size_bytes: file.size,
    })
    .select("id")
    .single();

  if (error !== null || data === null) {
    throw new ParticipationError("Could not save your document. Please try again.");
  }

  return data.id as string;
}

/**
 * The RPC's raised sentence is the student's only explanation ("There is
 * already a hold, or a request waiting, on your placements."), so it is kept.
 */
const withDetail = (summary: string, error: { message?: string }): ParticipationError =>
  new ParticipationError(
    typeof error.message === "string" && error.message.trim() !== ""
      ? `${summary} (${error.message})`
      : summary,
  );

/**
 * The student's own participation, against live data.
 *
 * Every permission question is answered by src/domain/participation.ts. The
 * database enforces the same rules independently: enforce_opt_out_irreversible
 * (0009) and one_approved_opt_out_per_student (0006).
 */
export function createSupabaseParticipationView(
  client: SupabaseClient,
  getStudentId: () => Promise<string | null>,
): ParticipationView {
  async function student() {
    const id = await getStudentId();
    if (id === null)
      throw new ParticipationError("Your session has expired. Please sign in again.");
    return id;
  }

  return {
    async status() {
      const studentId = await student();

      const [
        { data: row, error: rowError },
        { data: requests, error: requestsError },
        { data: placements, error: placementsError },
      ] = await Promise.all([
        client.from("students").select("participation_status").eq("id", studentId).single(),
        // F3: every request, decided or not. This used to ask only whether one
        // was pending, which is why an approved request could not be shown
        // back to the student who raised it.
        client
          .from("opt_out_requests")
          .select("id, reason, status, decision_reason, created_at")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false }),
        // Pending ones live here, not in `offers`: that table refuses a
        // self-placed row without an approver (0006).
        client
          .from("self_placement_requests")
          .select("id, company_name, role_title, ctc_lpa, status, decision_reason, created_at")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false }),
      ]);

      /*
       * None of these were checked, and `?? "active"` turned a refused status
       * read into a student who is taking part. This screen decides WRITES
       * from what it reads — `requestOptOut` asks `status()` whether a request
       * is already pending — so the silent failure both told an opted-out
       * student they were participating and let them file over an existing
       * request.
       */
      if (rowError !== null) {
        throw new ParticipationError(
          "We could not read your participation status. Please try again.",
        );
      }
      if (requestsError !== null) {
        throw new ParticipationError("We could not read your opt-out requests. Please try again.");
      }
      if (placementsError !== null) {
        throw new ParticipationError(
          "We could not read the placements you have reported. Please try again.",
        );
      }

      const decided = (value: unknown): RequestStatus =>
        value === "verified" || value === "rejected" ? value : "pending";

      return {
        participationStatus:
          (row?.participation_status as ParticipationStatus | undefined) ?? "active",
        optOutRequests: (requests ?? []).map((r) => ({
          id: r.id as string,
          reason: (r.reason as string | null) ?? "",
          submittedAt: (r.created_at as string | null) ?? "",
          status: decided(r.status),
          decisionReason: (r.decision_reason as string | null) ?? null,
        })),
        selfPlacements: (placements ?? []).map((p) => ({
          id: p.id as string,
          companyName: (p.company_name as string | null) ?? "Unknown company",
          roleTitle: (p.role_title as string | null) ?? null,
          ctcLpa: (p.ctc_lpa as number | null) ?? 0,
          submittedAt: (p.created_at as string | null) ?? "",
          status: decided(p.status),
          decisionReason: (p.decision_reason as string | null) ?? null,
        })),
      };
    },

    async requestOptOut({ reason, declaration }) {
      // Before the upload: an over-long reason must not leave an orphaned
      // declaration in the bucket behind a request that was never written.
      const reasonProblem = optOutReasonProblem(reason);
      if (reasonProblem !== null) throw new ParticipationError(reasonProblem);

      const studentId = await student();
      const current = await this.status();

      const decision = canRequestOptOut({
        participationStatus: current.participationStatus,
        hasPendingRequest: hasPendingRequest(current.optOutRequests),
        hasDeclaration: declaration !== undefined,
      });
      if (!decision.allowed) throw new ParticipationError(decision.reason);

      const declarationId = await uploadEvidence(
        client,
        studentId,
        "opt_out_declaration",
        declaration,
      );

      const { error } = await client
        .from("opt_out_requests")
        .insert({
          student_id: studentId,
          reason,
          status: "pending",
          declaration_id: declarationId,
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new ParticipationError("Could not send your request. Please try again.");
      }
    },

    async recordSelfPlacement(placement) {
      const studentId = await student();
      const current = await this.status();

      const decision = canRecordSelfPlacement({
        participationStatus: current.participationStatus,
        hasOfferLetter: placement.offerLetter !== undefined,
      });
      if (!decision.allowed) throw new ParticipationError(decision.reason);

      const offerLetterId = await uploadEvidence(
        client,
        studentId,
        "offer_letter",
        placement.offerLetter,
      );

      // Raised as a REQUEST. The `offers` row - and with it the statistic - is
      // created only when a coordinator approves (A18), because there is no
      // drive to corroborate an off-campus offer.
      const { error } = await client
        .from("self_placement_requests")
        .insert({
          student_id: studentId,
          company_name: placement.companyName,
          role_title: placement.roleTitle === "" ? null : placement.roleTitle,
          ctc_lpa: placement.ctcLpa,
          offer_letter_id: offerLetterId,
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new ParticipationError("Could not record the offer. Please try again.");
      }
    },

    async requestSelfPlacedHold(request) {
      const studentId = await student();
      const current = await this.status();

      const decision = canRequestSelfPlacedHold({
        participationStatus: current.participationStatus,
        hasOfferLetter: request.offerLetter !== undefined,
        hasDeclaration: request.declaration !== undefined,
      });
      if (!decision.allowed) throw new ParticipationError(decision.reason);

      // The same sentences the manager's dialog shows, asked before two
      // documents are uploaded over a window the database would refuse.
      const draftProblem = holdDraftProblem({
        kind: "self_placed",
        reason: request.reason,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
      });
      if (draftProblem !== null) throw new ParticipationError(draftProblem);

      const offerLetterId = await uploadEvidence(
        client,
        studentId,
        "offer_letter",
        request.offerLetter,
      );
      const declarationId = await uploadEvidence(
        client,
        studentId,
        "self_placement_declaration",
        request.declaration,
      );

      // Both rows in one transaction (0130): the offer request the coordinator
      // verifies, and the pending hold the Campus Manager confirms. Two client
      // writes could leave the student with half of what they sent.
      const { error } = await client.rpc("request_self_placed_hold", {
        p_offer_document_id: offerLetterId,
        p_declaration_id: declarationId,
        p_reason: request.reason.trim(),
        p_starts_at: request.startsAt,
        p_ends_at: request.endsAt,
        p_company_name: request.companyName,
        p_role_title: request.roleTitle === "" ? null : request.roleTitle,
        p_ctc_lpa: request.ctcLpa,
      });

      if (error !== null) {
        throw withDetail("Could not send your hold request.", error);
      }
    },
  };
}
