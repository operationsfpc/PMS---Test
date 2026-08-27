/**
 * R1 — Offer categories and the category ladder.
 *
 * PRD §10 / §12. The CTC bands are Admin-configurable *reference guidance*.
 * The Delivery Head makes the binding classification at PIF approval and it is
 * immutable thereafter (decision Q1) — this module only ever suggests.
 */

import type { DriveType } from "./types";

/**
 * Every value the column may hold.
 *
 * `internship` was added 2026-08-27 (Karthik: "add one more there, as
 * Internship"). It is a CATEGORY but **not a rung** — see `LADDER_CATEGORIES`.
 * A plain internship has never been on the ladder (PRD §11), and the database
 * enforces that a drive or offer may carry it only when its type is
 * `internship`.
 */
export const OFFER_CATEGORIES = ["regular", "dream", "super_dream", "internship"] as const;

export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

/**
 * The rungs, lowest first — the only categories that can be COMPARED.
 *
 * R5 asks "is this drive strictly higher than what the student already
 * holds?". That question has no answer for an internship, which is why
 * `offerCategoryRank` refuses it rather than returning a number that would
 * quietly place it above or below everything.
 */
export const LADDER_CATEGORIES = ["regular", "dream", "super_dream"] as const;

export type LadderCategory = (typeof LADDER_CATEGORIES)[number];

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

const RANK: Readonly<Record<LadderCategory, number>> = {
  regular: 1,
  dream: 2,
  super_dream: 3,
};

const isLadderCategory = (category: OfferCategory): category is LadderCategory =>
  category !== "internship";

/**
 * Position of a category on the ladder. Higher wins.
 *
 * **Throws** for `internship`. Returning 0 (or 4) would be worse than an
 * error: R5 would silently decide that an internship outranks — or is
 * outranked by — a real offer, and a student would be shown, or refused, a
 * drive on the strength of a number nobody chose. The database mirrors this
 * by ranking with an explicit CASE that yields NULL for the same value.
 */
export function offerCategoryRank(category: OfferCategory): number {
  if (!isLadderCategory(category)) {
    throw new RangeError(
      `"${category}" is not on the Regular → Dream → Super Dream ladder, so it has no rank.`,
    );
  }
  return RANK[category];
}

/** Ladder comparator: negative if `a` is lower, zero if equal, positive if higher. */
export function compareOfferCategory(a: OfferCategory, b: OfferCategory): number {
  return offerCategoryRank(a) - offerCategoryRank(b);
}

/**
 * Which categories a drive of this type may be given — answer 3, 2026-08-27:
 * "only for internship".
 *
 * The Delivery Head is never shown a choice the database would refuse. An
 * internship drive has exactly one category; everything else has the three
 * rungs and never the internship one.
 */
export function offerCategoriesFor(driveType: DriveType | null): readonly OfferCategory[] {
  return driveType === "internship" ? ["internship"] : LADDER_CATEGORIES;
}

/**
 * The category this drive type DECIDES for itself, if any.
 *
 * An internship's category is not a judgement, it is a restatement of its
 * type — so the screen fills it in and the Delivery Head is asked nothing.
 * Every other type returns null: the rung is theirs to choose, and §3.3 makes
 * it immutable, so nothing may choose it for them.
 */
export function requiredOfferCategoryFor(driveType: DriveType | null): OfferCategory | null {
  return driveType === "internship" ? "internship" : null;
}

/**
 * Whether naming the category would only repeat the type tag beside it.
 *
 * UAT 2026-08-27 (`docs/inbox/WhatsApp Image 2026-08-27 at 17.40.11.jpeg`):
 * the drive record page showed "Internship" and "internship" side by side —
 * the category and the type, the same word twice. PB3 had already settled
 * this for the student card, but it was settled *in the JSX*, as a literal
 * `!== "internship"`. Every other screen that shows both facts kept the
 * duplicate, because the rule was not anywhere they could reach.
 *
 * Derived from `requiredOfferCategoryFor` rather than tested against the
 * literal: when a type dictates its category, saying it twice is the
 * definition of redundant. A drive with no declared type has said nothing, so
 * nothing is being repeated and the category still has to be shown.
 */
export function offerCategoryRestatesType(
  driveType: DriveType | null,
  category: OfferCategory | null,
): boolean {
  return category !== null && requiredOfferCategoryFor(driveType) === category;
}

/**
 * The pairing rule, mirroring the database's
 * `internship_carries_internship_category` constraint on both `drives` and
 * `offers`. Change both or neither.
 */
export function offerCategoryAllowedFor(
  driveType: DriveType | null,
  category: OfferCategory,
): boolean {
  return driveType === "internship" ? category === "internship" : category !== "internship";
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
): LadderCategory {
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
): LadderCategory | null {
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
  internship: "Internship",
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
