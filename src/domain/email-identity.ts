/**
 * One email identifies one person (asked for 2026-08-06).
 *
 * "can you block an email id from being entered twice? student + student as
 * well as student+staff"
 *
 * This is the root cause of P8, not a tidiness rule. `sainaveen@faceprep.in`
 * was on the student roster AND held a staff profile, on one Google account.
 * Everyone signs in with their address, so one address is one identity - and
 * `protect_verified_academics` (0009) identifies a student by exactly that.
 * The dual identity made the only campus coordinator unable to approve any
 * registration form, and would have let them verify their own certificates.
 *
 * A staff INVITATION and the PROFILE it becomes are ONE person, not two. That
 * pair is the normal state of every staff member and is never a clash.
 *
 * Mirrored by migration 0040, which enforces the same rule where no screen can
 * forget it. The comparison must not drift from the one the indexes use.
 */

export type EmailHolder = "student" | "staff";

/**
 * The canonical form of an address.
 *
 * A login is not case-sensitive, so neither is identity: `Priya@Gmail.com` and
 * `priya@gmail.com` are one person and must never be two rows.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const BOTH = "One person is either a student or staff, never both — use a different address.";

/**
 * Why this address cannot be given to a new person, or null when it is free.
 *
 * `taken` is keyed by the NORMALISED address, so the caller normalises once
 * when building it rather than on every comparison.
 */
export function emailClash(
  email: string,
  taken: ReadonlyMap<string, EmailHolder>,
  claimant: EmailHolder,
): string | null {
  const normalised = normaliseEmail(email);
  const holder = taken.get(normalised);
  if (holder === undefined) return null;

  // Same kind: an ordinary duplicate, and the message says so plainly.
  if (holder === claimant) {
    return claimant === "student"
      ? `${normalised} is already on the student roster.`
      : `${normalised} has already been invited.`;
  }

  // Different kinds: the case that caused P8. The reason is spelled out,
  // because "already taken" would leave an administrator guessing which of
  // two screens is holding it.
  return holder === "staff"
    ? `${normalised} is already a staff account. ${BOTH}`
    : `${normalised} is already on the student roster. ${BOTH}`;
}
