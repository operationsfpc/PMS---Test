/**
 * When is a drive finished? Batch C item 3 (2026-08-21, answer 3b).
 *
 * "A drive is completed when results for all students are out." The Central
 * CPC marks it — and may mark it EARLY with a typed reason (audit-logged),
 * because real drives fizzle: the company walks away, and a drive stuck
 * "in rounds" forever is a lie on every screen that counts it.
 */

import type { ApplicationStage } from "./student-progress";
import type { AppRole } from "./types";

/** The two stages an application can rest in. Everything else is pending. */
const TERMINAL_STAGES: readonly ApplicationStage[] = ["selected", "not_selected"];

export interface CompletionReadiness {
  readonly ready: boolean;
  /** Applicants still without a final outcome. */
  readonly undecided: number;
}

export function completionReadiness(
  applications: readonly { readonly stage: ApplicationStage }[],
): CompletionReadiness {
  const undecided = applications.filter((a) => !TERMINAL_STAGES.includes(a.stage)).length;
  return { ready: undecided === 0, undecided };
}

/** One verb, one role (0047): completing the drive is the Central CPC's. */
export function canCompleteDrive(role: AppRole): boolean {
  return role === "central_placement_coordinator";
}

/** Shorter than this is not an explanation — the participation-queue bar. */
const MIN_REASON = 5;

export type CompletionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Ready drives complete silently. Early completion demands a reason the
 * audit log (and the undecided students) can be shown.
 */
export function decideCompletion(
  readiness: CompletionReadiness,
  reason: string,
): CompletionDecision {
  if (readiness.ready) return { allowed: true };
  if (reason.trim().length < MIN_REASON) {
    return {
      allowed: false,
      reason:
        `${readiness.undecided} student(s) still have no final outcome. ` +
        "Give a reason for completing the drive early — it is audit-logged.",
    };
  }
  return { allowed: true };
}
