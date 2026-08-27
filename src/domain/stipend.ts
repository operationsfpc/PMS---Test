/**
 * A monthly stipend, in words.
 *
 * Karthik, 2026-08-27: "while approving internship PIF, stipend mentioned has
 * to be shown to delivery head. this is currently missing." The Delivery Head
 * was approving the commercials of an internship without being shown the only
 * number an internship has.
 *
 * The sibling of `describeCtcRange` (C3), and here for the same reason: one
 * formatter, used by every screen, so a stipend never reads two ways.
 */

/**
 * Grouped the Indian way — ₹1,50,000, not ₹150,000. They are the same number
 * and are not read at the same speed by the person making the decision.
 *
 * `en-IN` is stated explicitly rather than left to the browser's locale: a
 * coordinator whose machine is set to en-US must not be shown a different
 * number from the one their colleague is looking at.
 */
const rupees = (value: number) => `₹${new Intl.NumberFormat("en-IN").format(value)}`;

/**
 * `(15000, 20000)` → "₹15,000–20,000 / month"
 * `(15000, null)`  → "₹15,000 / month"
 * `(null, null)`   → null — nothing to say, so nothing is said.
 *
 * Zero is treated as absent: a stipend of ₹0 is not an offer of free labour,
 * it is a blank somebody typed a zero into.
 */
export function describeStipendRange(
  minMonthly: number | null,
  maxMonthly: number | null,
): string | null {
  const min = minMonthly !== null && minMonthly > 0 ? minMonthly : null;
  const max = maxMonthly !== null && maxMonthly > 0 ? maxMonthly : null;

  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) {
    // Only the floor carries the ₹ — "₹15,000–20,000" is how it is written.
    return `${rupees(min)}–${new Intl.NumberFormat("en-IN").format(max)} / month`;
  }
  return `${rupees((min ?? max) as number)} / month`;
}

/** Whether this drive records any pay at all — a CTC or a stipend. */
export function hasAnyPay(
  ctcMinLpa: number | null,
  stipendMinMonthly: number | null,
  stipendMaxMonthly: number | null,
): boolean {
  return ctcMinLpa !== null || describeStipendRange(stipendMinMonthly, stipendMaxMonthly) !== null;
}
