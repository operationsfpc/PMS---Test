/**
 * C3 (UAT 2026-08-19): "when a company runs multiple drives, its name appears
 * twice in listings with no way to tell them apart." Role title plus the CTC
 * band is the identifier — two HCL drives differ in exactly those.
 *
 * One formatter, used by every listing, so the same drive never reads two
 * different ways on two screens.
 */

/** `(3, 3.5)` → "₹3–3.5 LPA" · `(3, null)` → "₹3 LPA" · `(null, null)` → null. */
export function describeCtcRange(minLpa: number | null, maxLpa: number | null): string | null {
  if (minLpa === null && maxLpa === null) return null;
  if (minLpa !== null && maxLpa !== null && minLpa !== maxLpa) {
    return `₹${minLpa}–${maxLpa} LPA`;
  }
  return `₹${minLpa ?? maxLpa} LPA`;
}
