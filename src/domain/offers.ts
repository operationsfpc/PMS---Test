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
  /**
   * Null on a plain internship, which records a monthly stipend instead
   * (0070, 2026-08-27). Before that this was `number` and `Number(null)` made
   * an internship worth **0** — a figure nobody chose, in the same field as
   * real salaries. The filters below meant it was never averaged, but a silent
   * zero is the shape of the bug that put ₹10 LPA against ₹15,000 a month.
   */
  readonly ctcLpa: number | null;
  readonly declaredAt: Date;
  readonly source: OfferSource;
}

/** Drive types that sit on the Regular → Dream → Super Dream ladder. */
const LADDER_DRIVE_TYPES: readonly DriveType[] = ["placement", "internship_convertible"];

/** Drive types that consume the one-internship cap. */
const INTERNSHIP_DRIVE_TYPES: readonly DriveType[] = ["internship", "internship_convertible"];

/**
 * Self-placed offers are reported as a separate statistic (PRD §16.2) — R9
 * and every placement figure exclude them. But since 2026-08-12 (D5,
 * client-confirmed reversal of §16.2's eligibility half) they DO climb the
 * ladder and consume the internship cap, exactly like on-campus offers: a
 * student self-placed at Dream may only pursue Super Dream, and a
 * self-placed internship exhausts the one-internship allowance.
 */
const isOnCampus = (offer: Offer): boolean => offer.source === "on_campus";

/** Offers that count towards the placement record set (PRD §12). */
export function placementOffers(offers: readonly Offer[]): readonly Offer[] {
  return offers.filter((o) => isOnCampus(o) && LADDER_DRIVE_TYPES.includes(o.driveType));
}

/** The highest-CTC offer, ties to the earliest declared — R9's rule, reused. */
function bestByCtc(candidates: readonly Offer[]): Offer | null {
  let best: Offer | null = null;
  for (const offer of candidates) {
    // An offer with no CTC cannot win a comparison of CTCs. It is skipped
    // rather than read as zero, which would have it lose to everything and
    // beat nothing — the right answer by accident, for the wrong reason.
    if (offer.ctcLpa === null) continue;
    // `best` only ever holds an offer that passed the guard above, so its CTC
    // is never null here — no second check, which would be a branch no input
    // can reach and no test can honestly cover.
    if (
      best === null ||
      (best.ctcLpa as number) < offer.ctcLpa ||
      (offer.ctcLpa === best.ctcLpa && offer.declaredAt < best.declaredAt)
    ) {
      best = offer;
    }
  }
  return best;
}

/**
 * The placement a DIRECTORY shows for this student — a different question
 * from R9's reporting record.
 *
 * C1 (UAT 2026-08-19): a self-placed student appeared under "Not Placed" in
 * the All Students view, because the screen asked `resolvePlacementRecord`,
 * whose job is the reported statistic and which excludes self-placed offers
 * by design (PRD §16.2). A coordinator looking at the list asks "does this
 * student have a job?", and a self-placed student does.
 *
 * The on-campus record still wins when both exist — it is the official one.
 * Self-placed fills the gap, chosen by the same highest-CTC rule. A plain
 * internship is not a placement from either source.
 */
export function resolveDisplayedPlacement(offers: readonly Offer[]): Offer | null {
  const record = resolvePlacementRecord(offers);
  if (record !== null) return record;

  return bestByCtc(
    offers.filter((o) => !isOnCampus(o) && LADDER_DRIVE_TYPES.includes(o.driveType)),
  );
}

/** Offers that occupy a rung on the Regular → Dream → Super Dream ladder. */
function ladderOffers(offers: readonly Offer[]): readonly Offer[] {
  return offers.filter((o) => LADDER_DRIVE_TYPES.includes(o.driveType));
}

/** R3 — the highest ladder position the student currently holds. */
export function highestOfferCategory(offers: readonly Offer[]): OfferCategory | null {
  let highest: OfferCategory | null = null;

  for (const offer of ladderOffers(offers)) {
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
  return offers.some((o) => INTERNSHIP_DRIVE_TYPES.includes(o.driveType));
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

  return bestByCtc(candidates);
}
