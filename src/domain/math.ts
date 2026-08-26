/**
 * Numeric helpers for money and marks.
 *
 * CLAUDE.md: never compare money or marks with floating-point equality, and
 * never publish a figure without rounding it deliberately. `0.1 + 0.2` is
 * `0.30000000000000004`, and an average of three packages is worse — a
 * dashboard that prints `7.166666666666667 LPA` is not a rounding bug, it is a
 * credibility problem.
 */

/**
 * Rounds half away from zero, which is what a reader of money expects.
 *
 * `Math.round` alone is asymmetric about negatives and, worse, is subject to
 * the representation error it is being used to hide: `Math.round(1.005 * 100)`
 * is 100, not 101, because 1.005 is really 1.00499999999999989. Scaling
 * through the decimal exponent in a string avoids the intermediate multiply.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;

  const scaled = Number(`${value}e${decimals}`);
  const rounded = value < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return Number(`${rounded}e-${decimals}`);
}

/** Money, as published: two decimal places. */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/**
 * Two money figures that mean the same amount.
 *
 * CLAUDE.md forbids `===` on money, and this is where that rule is kept. The
 * comparison is made at the precision money is PUBLISHED at, rather than
 * against an epsilon: an epsilon is itself a float, so `6.505 - 6.5 < 0.005`
 * is true, and the guard against representation error would have been written
 * in the same representation error.
 *
 * Added 2026-08-26: the package figures on the placement overview link to the
 * students holding exactly that CTC.
 */
export function sameMoney(a: number, b: number): boolean {
  return roundMoney(a) === roundMoney(b);
}

/** A percentage, as published: one decimal place. */
export function roundPercent(value: number): number {
  return roundTo(value, 1);
}

/**
 * A percentage that never divides by zero.
 *
 * An empty denominator is 0%, not NaN and not 100%: no students means no
 * placement rate, and both of the other answers are lies a screen would
 * happily render.
 */
export function percentOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return roundPercent((part / whole) * 100);
}
