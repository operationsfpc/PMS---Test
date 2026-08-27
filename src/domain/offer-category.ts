/**
 * R1 — Offer categories and the category ladder.
 *
 * PRD §10 / §12. The CTC bands are Admin-configurable *reference guidance*.
 * The Delivery Head makes the binding classification at PIF approval and it is
 * immutable thereafter (decision Q1) — this module only ever suggests.
 */

export const OFFER_CATEGORIES = ["regular", "dream", "super_dream"] as const;

export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

/**
 * Where each band STARTS, in lakhs per annum.
 *
 * SPEC CHANGE 2026-08-17 (Karthik): "5.00 is dream and 10.00 is super dream."
 * A band edge belongs to the band ABOVE it. The fields are named for the floor
 * they set rather than a ceiling, because the previous names (`regularMaxLpa`,
 * `dreamMaxLpa`) invited exactly the reading that put a ₹5 LPA offer in the
 * Regular row of the campus overview.
 */
export interface OfferCategoryBands {
  /** A CTC at or above this is at least `dream`. Below it is `regular`. */
  readonly dreamMinLpa: number;
  /** A CTC at or above this is `super_dream`. */
  readonly superDreamMinLpa: number;
}

export const DEFAULT_OFFER_CATEGORY_BANDS: OfferCategoryBands = {
  dreamMinLpa: 5,
  superDreamMinLpa: 10,
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
 * A band edge belongs to the band above it (Karthik, 2026-08-17): ₹4.99 LPA is
 * `regular`, ₹5.00 LPA is `dream`, ₹10.00 LPA is `super_dream`.
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

  assertAscending(bands);

  if (ctcLpa < bands.dreamMinLpa) return "regular";
  if (ctcLpa < bands.superDreamMinLpa) return "dream";
  return "super_dream";
}

/**
 * The same rule, asked as a question rather than an instruction: "what would
 * you suggest for this CTC, if anything?"
 *
 * UAT 2026-08-27 (live): the Delivery Head's approval queue died with "Could
 * not load the queue" because one waiting PIF was a cap-only internship
 * (0056), which legitimately has no CTC at all. `classifyOfferCategory` threw
 * — correctly, it is asked to classify a number — and one unusual row took
 * every pending approval in the organisation down with it.
 *
 * A missing CTC is an ABSENCE, not a programming error. The answer is "no
 * suggestion", and the Delivery Head decides. `classifyOfferCategory` stays
 * strict for callers that genuinely have a number and would rather hear about
 * a bug than swallow it.
 */
export function suggestOfferCategory(
  ctcLpa: number | null | undefined,
  bands: OfferCategoryBands = DEFAULT_OFFER_CATEGORY_BANDS,
): OfferCategory | null {
  if (ctcLpa === null || ctcLpa === undefined) return null;
  if (!Number.isFinite(ctcLpa) || ctcLpa <= 0) return null;
  return classifyOfferCategory(ctcLpa, bands);
}

/** Nonsense bands classify nonsense, so they are refused rather than applied. */
function assertAscending(bands: OfferCategoryBands): void {
  if (bands.dreamMinLpa >= bands.superDreamMinLpa) {
    throw new RangeError(
      `Offer category bands must ascend: dreamMinLpa (${bands.dreamMinLpa}) ` +
        `must be less than superDreamMinLpa (${bands.superDreamMinLpa})`,
    );
  }
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
 * `classifyOfferCategory` exactly: an edge belongs to the band above it, so
 * ₹5 LPA reads as "and above" under Dream and never as a Regular ceiling.
 *
 * @throws if the bands do not ascend.
 */
export function describeOfferCategoryBands(
  bands: OfferCategoryBands = DEFAULT_OFFER_CATEGORY_BANDS,
): readonly OfferCategoryBandDescription[] {
  assertAscending(bands);

  return [
    {
      category: "regular",
      label: CATEGORY_LABEL.regular,
      range: `below ${lpa(bands.dreamMinLpa)}`,
    },
    {
      category: "dream",
      label: CATEGORY_LABEL.dream,
      range: `${lpa(bands.dreamMinLpa)} and above, below ${lpa(bands.superDreamMinLpa)}`,
    },
    {
      category: "super_dream",
      label: CATEGORY_LABEL.super_dream,
      range: `${lpa(bands.superDreamMinLpa)} and above`,
    },
  ];
}
