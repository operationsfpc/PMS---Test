import type { OfferCategory } from "@domain/offer-category";
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
  readonly ctcLpa: number;
}

export interface OffersRepository {
  declareOffer(offer: DeclaredOffer): Promise<void>;
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
      if (offer.driveType === "internship" && offer.offerCategory !== null) {
        throw new OffersError(
          "A plain internship has no offer category — it sits outside the category ladder.",
        );
      }
      if (offer.driveType !== "internship" && offer.offerCategory === null) {
        throw new OffersError(
          "An offer category is required for a placement or convertible offer.",
        );
      }
      if (offer.ctcLpa < 0) {
        throw new OffersError("CTC cannot be negative.");
      }

      const actorId = await getActorId();
      if (actorId === null) {
        throw new OffersError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("offers")
        .insert({
          student_id: offer.studentId,
          drive_id: offer.driveId,
          source: "on_campus",
          company_name: offer.companyName,
          role_title: offer.roleTitle,
          drive_type: offer.driveType,
          offer_category: offer.offerCategory,
          ctc_lpa: offer.ctcLpa,
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
  };
}
