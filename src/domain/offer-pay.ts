/**
 * What an offer PAYS, and how that is said.
 *
 * Karthik, 2026-08-27 ("go with option 1"): an internship offer records a
 * **stipend**, not a CTC.
 *
 * P10 (resolved the same day) let a drive go live on a stipend alone. The
 * offer at the end of that drive still demanded an annual CTC, because
 * `offers.ctc_lpa` was NOT NULL and the declare screen refused anything ≤ 0.
 * Two live internship offers were therefore recorded at **₹10 LPA and ₹12
 * LPA** against a drive paying **₹15,000 a month**. Nobody mistyped them; the
 * box would not take anything else.
 *
 * The sibling of `stipend.ts` (which does the same job for a DRIVE) and of
 * `ctc.ts`. One formatter, one guard, so no two screens quote an offer
 * differently.
 */

import { describeStipendRange } from "./stipend";
import type { DriveType } from "./types";

/** Drive types whose offer is a salary, quoted per annum. */
const SALARIED: readonly DriveType[] = ["placement", "internship_convertible"];

export interface OfferPay {
  readonly driveType: DriveType;
  readonly ctcLpa: number | null;
  readonly stipendMonthly: number | null;
}

/**
 * Zero is a blank somebody typed a zero into, not an offer of free labour —
 * the same reading `describeStipendRange` already takes.
 */
const positive = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;

/**
 * Whether this offer belongs in the package figures.
 *
 * `placementOffers` has excluded plain internships from the placement record
 * set since the beginning, so the dashboards were never wrong. This states
 * the same rule for the screens that quote an offer's money DIRECTLY — the
 * student's own dashboard and the CPC's progress board, which both printed
 * "₹10 LPA" against an internship.
 */
export function offerCountsAsPackage(driveType: DriveType): boolean {
  return SALARIED.includes(driveType);
}

/**
 * The offer's pay, in words.
 *
 * Never "₹0 LPA": an offer with nothing recorded says so, because a zero
 * reads as a figure somebody meant.
 */
export function describeOfferPay(pay: OfferPay): string {
  if (offerCountsAsPackage(pay.driveType)) {
    const ctc = positive(pay.ctcLpa);
    return ctc === null ? "Pay not recorded" : `₹${ctc} LPA`;
  }

  return describeStipendRange(positive(pay.stipendMonthly), null) ?? "Pay not recorded";
}

/**
 * The screen's guard, mirroring the `offer_records_what_it_pays` constraint
 * added in `0070`. Change both or neither.
 *
 * Both directions are refused, not just the missing one: an internship that
 * ALSO carries a CTC leaves the reader to decide which is true, and the two
 * screens quoting them would disagree. One fact, one spelling — the same
 * argument as PB2.
 */
export function offerPayProblem(pay: OfferPay): string | null {
  const ctc = positive(pay.ctcLpa);
  const stipend = positive(pay.stipendMonthly);

  if (pay.ctcLpa !== null && ctc === null && pay.ctcLpa !== 0) {
    return "Enter a valid CTC in LPA.";
  }
  if (pay.stipendMonthly !== null && stipend === null && pay.stipendMonthly !== 0) {
    return "Enter a valid monthly stipend in rupees.";
  }

  if (offerCountsAsPackage(pay.driveType)) {
    if (ctc === null) return "Enter the CTC in LPA for this offer.";
    if (stipend !== null) {
      return "A salaried offer records a CTC, not a stipend. Clear the stipend.";
    }
    return null;
  }

  if (stipend === null) return "Enter the monthly stipend for this internship offer.";
  if (ctc !== null) {
    return "An internship offer records a stipend, not a CTC. Clear the CTC.";
  }
  return null;
}
