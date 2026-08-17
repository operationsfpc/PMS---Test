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

/** One band, in words. */
export interface OfferCategoryBandDescription {
  readonly category: OfferCategory;
  readonly label: string;
  /** e.g. "above ₹5 LPA and up to ₹10 LPA". */
  readonly range: string;
}

const CATEGORY_LABEL: Readonly<Record<OfferCategory, string>> = {
  regular: "Regular",
  dream: "Dream",
  super_dream: "Super Dream",
};

/** Human label for a category. One spelling, so no two screens disagree. */
export function offerCategoryLabel(category: OfferCategory): string {
  return CATEGORY_LABEL[category];
}

/** `5` → "₹5 LPA"; `4.5` → "₹4.5 LPA". No trailing zeros, no lost decimals. */
const lpa = (value: number) => `₹${value} LPA`;

/**
 * The bands as prose, for the screen where the Delivery Head classifies a
 * drive (§17.5). Requested 2026-08-17: the classification is immutable once
 * saved (§3.3), so the rule has to be visible at the moment of the decision.
 *
 * Derived from the bands, never typed alongside them — bands are
 * Admin-configurable, and a hardcoded sentence would start lying the first
 * time anyone retunes them. The boundary wording matches
 * `classifyOfferCategory` exactly: the lower band owns its upper edge, so
 * ₹5.00 LPA is Regular and ₹5.01 LPA is Dream.
 *
 * @throws if the bands do not ascend.
 */
export function describeOfferCategoryBands(
  bands: OfferCategoryBands = DEFAULT_OFFER_CATEGORY_BANDS,
): readonly OfferCategoryBandDescription[] {
  if (bands.regularMaxLpa >= bands.dreamMaxLpa) {
    throw new RangeError(
      `Offer category bands must ascend: regularMaxLpa (${bands.regularMaxLpa}) ` +
        `must be less than dreamMaxLpa (${bands.dreamMaxLpa})`,
    );
  }

  return [
    {
      category: "regular",
      label: CATEGORY_LABEL.regular,
      range: `up to ${lpa(bands.regularMaxLpa)}`,
    },
    {
      category: "dream",
      label: CATEGORY_LABEL.dream,
      range: `above ${lpa(bands.regularMaxLpa)} and up to ${lpa(bands.dreamMaxLpa)}`,
    },
    {
      category: "super_dream",
      label: CATEGORY_LABEL.super_dream,
      range: `above ${lpa(bands.dreamMaxLpa)}`,
    },
  ];
}
