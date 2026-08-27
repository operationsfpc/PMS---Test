import { OFFER_LETTER_BUCKET, offerLetterFileProblem } from "@domain/attachments";
import type { OfferCategory } from "@domain/offer-category";
import { offerPayProblem } from "@domain/offer-pay";
import type { AppRole, DriveType } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class OffersError extends Error {}

export interface DeclaredOffer {
  readonly studentId: string;
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly driveType: DriveType;
  readonly offerCategory: OfferCategory | null;
  /** Null on a plain internship, which is paid a stipend instead (0070). */
  readonly ctcLpa: number | null;
  /** Set on a plain internship only — the mirror of `ctcLpa`. */
  readonly stipendMonthly?: number | null;
  /**
   * Spec B (approved 2026-08-24): the recruiter's letter, filed with the
   * declaration. Optional — a letter that arrives later is attached with
   * `attachLetter` (answer 1d).
   */
  readonly letter?: File | null;
}

export interface OffersRepository {
  declareOffer(offer: DeclaredOffer): Promise<void>;
  /** Answer 1d: a letter arriving after declaration is still filed. */
  attachLetter(studentId: string, driveId: string, letter: File): Promise<void>;
}

/**
 * Final selection.
 *
 * PRD §6: being placed is an explicit declaration, never inferred from the
 * last round's results - a recruiter's final round is not always their final
 * word, and inferring it would place students who were never offered anything.
 *
 * This row is the input to R3 (highest category), R4 (internship cap) and R9
 * (placement record), so its shape decides what every one of those rules sees.
 */
export function createSupabaseOffersRepository(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): OffersRepository {
  return {
    async declareOffer(offer) {
      if ((await getActorRole()) !== "central_placement_coordinator") {
        throw new OffersError("Only the Central Placement Coordinator may declare an offer.");
      }

      // Mirrors the database's own constraints, so the message is useful
      // rather than a raw constraint name.
      // 2026-08-27 (PB2): an internship offer carries the internship category
      // — required, not optional, so "is this an internship?" has exactly one
      // answer in the data. It is still on no rung of the ladder.
      if (offer.driveType === "internship" && offer.offerCategory !== "internship") {
        throw new OffersError(
          "A plain internship is classified Internship — it sits outside the Regular/Dream/Super Dream ladder.",
        );
      }
      if (offer.driveType !== "internship" && offer.offerCategory === "internship") {
        throw new OffersError("Only a plain internship can carry the Internship category.");
      }
      if (offer.driveType !== "internship" && offer.offerCategory === null) {
        throw new OffersError(
          "An offer category is required for a placement or convertible offer.",
        );
      }
      // 0070: an offer records what it PAYS — a plain internship a monthly
      // stipend, everything else an annual CTC, and never both. The same
      // guard the database enforces, so the caller hears a sentence rather
      // than a constraint name.
      const payProblem = offerPayProblem({
        driveType: offer.driveType,
        ctcLpa: offer.ctcLpa,
        stipendMonthly: offer.stipendMonthly ?? null,
      });
      if (payProblem !== null) {
        throw new OffersError(payProblem);
      }

      const actorId = await getActorId();
      if (actorId === null) {
        throw new OffersError("Your session has expired. Please sign in again.");
      }

      // The 0051 order: the object first, the row after. An orphan object is
      // invisible and cheap; a row pointing at nothing is a dead link handed
      // to the student the letter belongs to.
      const attachment =
        offer.letter == null
          ? null
          : await uploadLetter(offer.studentId, offer.driveId, offer.letter);

      const { error } = await client
        .from("offers")
        .insert({
          ...(attachment === null
            ? {}
            : { attachment_path: attachment.path, attachment_name: attachment.name }),
          student_id: offer.studentId,
          drive_id: offer.driveId,
          source: "on_campus",
          company_name: offer.companyName,
          role_title: offer.roleTitle,
          drive_type: offer.driveType,
          offer_category: offer.offerCategory,
          ctc_lpa: offer.ctcLpa,
          stipend_monthly: offer.stipendMonthly ?? null,
          declared_by: actorId,
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new OffersError(
          error.code === "23505"
            ? "This student has already been declared selected for this drive."
            : "Could not declare the offer. Please try again.",
        );
      }
    },

    async attachLetter(studentId, driveId, letter) {
      if ((await getActorRole()) !== "central_placement_coordinator") {
        throw new OffersError("Only the Central Placement Coordinator may attach an offer letter.");
      }

      const attachment = await uploadLetter(studentId, driveId, letter);

      // Deliberately ONLY the attachment columns: the CTC and category were
      // declared and audited; a late letter must not be a route to rewrite
      // them.
      const { error } = await client
        .from("offers")
        .update({ attachment_path: attachment.path, attachment_name: attachment.name })
        .eq("student_id", studentId)
        .eq("drive_id", driveId)
        .select("id");

      if (error !== null) {
        throw new OffersError("Could not file the offer letter. Please try again.");
      }
    },
  };

  async function uploadLetter(
    studentId: string,
    driveId: string,
    letter: File,
  ): Promise<{ path: string; name: string }> {
    const problem = offerLetterFileProblem(letter);
    if (problem !== null) throw new OffersError(problem);

    const path = `${studentId}/${driveId}/${Date.now()}-${letter.name}`;
    const { error } = await client.storage
      .from(OFFER_LETTER_BUCKET)
      .upload(path, letter, { contentType: letter.type });

    if (error !== null) {
      throw new OffersError(
        "Could not upload the offer letter. Check your connection and try again — nothing has been saved.",
      );
    }

    return { path, name: letter.name };
  }
}
