/**
 * SRF field rules. PRD §4.1.
 *
 * These live in the domain because they are business rules, not form plumbing.
 * The Zod schema in the feature layer calls into these — it never restates them.
 */

import type { RoleCategory } from "./types";

/** Marks are stored as percentages (decision Q8). */
export function isValidPercentage(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/** CGPA is on a 10-point scale. */
export function isValidCgpa(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 10;
}

/** Indian mobile numbers: 10 digits beginning 6–9. */
export function isValidIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value);
}

export function isValidArrearCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * A standing arrear is by definition part of the arrear history, so history can
 * never be lower than the current count. Catching this at entry protects the
 * `no_history` vs `no_standing` eligibility distinction (decision Q6).
 */
export function isConsistentArrears(currentArrears: number, historyOfArrears: number): boolean {
  return historyOfArrears >= currentArrears;
}

/** Students may register for the current cohort and nearby years only. */
export function isValidPassingYear(year: number, now: Date): boolean {
  if (!Number.isInteger(year)) return false;
  const thisYear = now.getUTCFullYear();
  return year >= thisYear - 5 && year <= thisYear + 6;
}

/**
 * PRD §4.1 requires one resume per selected role category. Returns the
 * categories still missing a resume, so the UI can point at each one.
 */
export function missingResumesFor(
  selected: readonly RoleCategory[],
  uploaded: readonly RoleCategory[],
): readonly RoleCategory[] {
  return selected.filter((category) => !uploaded.includes(category));
}
