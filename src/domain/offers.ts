/**
 * R3 / R4 / R9 — Offers, the category ladder, the internship cap,
 * and the placement record. PRD §11, §12, §16.2.
 *
 * A "final selection result" IS an offer: declaration is treated as offer made
 * and accepted; there is no separate acceptance step in MVP (PRD §12).
 */

import { type OfferCategory, offerCategoryRank } from "./offer-category";
import type { DriveType, OfferSource } from "./types";

export interface Offer {
  readonly id: string;
  readonly driveId: string;
  readonly driveType: DriveType;
  /** Null for plain internships, which are not classified. */
  readonly offerCategory: OfferCategory | null;
  readonly ctcLpa: number;
  readonly declaredAt: Date;
  readonly source: OfferSource;
}

/** Drive types that sit on the Regular → Dream → Super Dream ladder. */
const LADDER_DRIVE_TYPES: readonly DriveType[] = ["placement", "internship_convertible"];

/** Drive types that consume the one-internship cap. */
const INTERNSHIP_DRIVE_TYPES: readonly DriveType[] = ["internship", "internship_convertible"];

/**
 * Self-placed offers are reported as a separate statistic and must never affect
 * on-campus eligibility, the ladder, or the cap (PRD §16.2).
 */
const isOnCampus = (offer: Offer): boolean => offer.source === "on_campus";

/** Offers that count towards the placement record set (PRD §12). */
export function placementOffers(offers: readonly Offer[]): readonly Offer[] {
  return offers.filter((o) => isOnCampus(o) && LADDER_DRIVE_TYPES.includes(o.driveType));
}

/** R3 — the highest ladder position the student currently holds. */
export function highestOfferCategory(offers: readonly Offer[]): OfferCategory | null {
  let highest: OfferCategory | null = null;

  for (const offer of placementOffers(offers)) {
    const category = offer.offerCategory;
    if (category === null) continue;
    if (highest === null || offerCategoryRank(category) > offerCategoryRank(highest)) {
      highest = category;
    }
  }

  return highest;
}

/** R4 — the cap is one internship per student, for their entire tenure. */
export function isInternshipCapConsumed(offers: readonly Offer[]): boolean {
  return offers.some((o) => isOnCampus(o) && INTERNSHIP_DRIVE_TYPES.includes(o.driveType));
}

/**
 * R9 — the single offer reported as the student's placement.
 *
 * Highest CTC wins; ties break to the earliest declared (decision Q3).
 * A Central CPC override always wins and must be audit-logged by the caller.
 *
 * @throws if the override does not name an offer in the placement record set.
 */
export function resolvePlacementRecord(
  offers: readonly Offer[],
  overrideOfferId?: string,
): Offer | null {
  const candidates = placementOffers(offers);

  if (overrideOfferId !== undefined) {
    const chosen = candidates.find((o) => o.id === overrideOfferId);
    if (chosen === undefined) {
      throw new Error(
        `Placement record override "${overrideOfferId}" does not name an eligible on-campus ` +
          "placement or internship-convertible offer for this student.",
      );
    }
    return chosen;
  }

  let best: Offer | null = null;
  for (const offer of candidates) {
    if (best === null) {
      best = offer;
      continue;
    }
    if (offer.ctcLpa > best.ctcLpa) {
      best = offer;
    } else if (offer.ctcLpa === best.ctcLpa && offer.declaredAt < best.declaredAt) {
      best = offer;
    }
  }

  return best;
}
