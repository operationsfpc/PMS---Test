import { canRecordSelfPlacement, canRequestOptOut } from "@domain/participation";
import type { ParticipationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParticipationView } from "./participation-page";

export class ParticipationError extends Error {}

/** Where each kind of evidence lives. Both buckets are private (0010, 0022). */
const BUCKETS = {
  offer_letter: "offer-letters",
  opt_out_declaration: "declarations",
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
  const path = `${studentId}/${Date.now()}-${file.name}`;

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
      storage_path: `${BUCKETS[kind]}/${path}`,
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

      const [{ data: row }, { data: requests }, { data: placements }] = await Promise.all([
        client.from("students").select("participation_status").eq("id", studentId).single(),
        client.from("opt_out_requests").select("id, status").eq("student_id", studentId),
        // Pending ones live here, not in `offers`: that table refuses a
        // self-placed row without an approver (0006).
        client
          .from("self_placement_requests")
          .select("id, company_name, ctc_lpa, status")
          .eq("student_id", studentId),
      ]);

      return {
        participationStatus:
          (row?.participation_status as ParticipationStatus | undefined) ?? "active",
        hasPendingRequest: (requests ?? []).some((r) => r.status === "pending"),
        selfPlacements: (placements ?? []).map((p) => ({
          id: p.id as string,
          companyName: (p.company_name as string | null) ?? "Unknown company",
          ctcLpa: (p.ctc_lpa as number | null) ?? 0,
          approved: p.status === "verified",
        })),
      };
    },

    async requestOptOut({ reason, declaration }) {
      const studentId = await student();
      const current = await this.status();

      const decision = canRequestOptOut({
        participationStatus: current.participationStatus,
        hasPendingRequest: current.hasPendingRequest,
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
  };
}
