/**
 * R1 — Offer categories and the category ladder.
 *
 * PRD §10 / §12. The CTC bands are Admin-configurable *reference guidance*.
 * The Delivery Head makes the binding classification at PIF approval and it is
 * immutable thereafter (decision Q1) — this module only ever suggests.
 */

export const OFFER_CATEGORIES = ["regular", "dream", "super_dream"] as const;

export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export interface OfferCategoryBands {
  /** Inclusive upper bound of the `regular` band, in lakhs per annum. */
  readonly regularMaxLpa: number;
  /** Inclusive upper bound of the `dream` band, in lakhs per annum. */
  readonly dreamMaxLpa: number;
}

export const DEFAULT_OFFER_CATEGORY_BANDS: OfferCategoryBands = {
  regularMaxLpa: 5,
  dreamMaxLpa: 10,
};

const RANK: Readonly<Record<OfferCategory, number>> = {
  regular: 1,
  dream: 2,
  super_dream: 3,
};

/** Position of a category on the ladder. Higher wins. */
export function offerCategoryRank(category: OfferCategory): number {
  return RANK[category];
}

/** Ladder comparator: negative if `a` is lower, zero if equal, positive if higher. */
export function compareOfferCategory(a: OfferCategory, b: OfferCategory): number {
  return offerCategoryRank(a) - offerCategoryRank(b);
}

/**
 * Suggests an offer category for a CTC.
 *
 * Boundaries are inclusive of the lower band: ₹5.00 LPA is `regular`,
 * ₹5.01 LPA is `dream`.
 *
 * @throws if the CTC is not a positive finite number, or the bands are not ascending.
 */
export function classifyOfferCategory(
  ctcLpa: number,
  bands: OfferCategoryBands = DEFAULT_OFFER_CATEGORY_BANDS,
): OfferCategory {
  if (!Number.isFinite(ctcLpa) || ctcLpa <= 0) {
    throw new RangeError(`CTC must be a positive finite number in LPA, received: ${ctcLpa}`);
  }

  if (bands.regularMaxLpa >= bands.dreamMaxLpa) {
    throw new RangeError(
      `Offer category bands must ascend: regularMaxLpa (${bands.regularMaxLpa}) ` +
        `must be less than dreamMaxLpa (${bands.dreamMaxLpa})`,
    );
  }

  if (ctcLpa <= bands.regularMaxLpa) return "regular";
  if (ctcLpa <= bands.dreamMaxLpa) return "dream";
  return "super_dream";
}
