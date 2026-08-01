import type { AppRole } from "./types";

/**
 * The screen a role lands on immediately after signing in.
 *
 * One login screen serves everybody; this rule decides where they go next.
 *
 * `null` means the role has no dedicated screen yet. Only four screens exist
 * today. Rather than invent landing pages for the remaining seven roles, this
 * returns null and the UI shows an explicit "no dashboard yet" state, so an
 * unconfirmed product decision never hides inside a redirect.
 */
const LANDING_ROUTES: Partial<Record<AppRole, string>> = {
  student: "/student",
  campus_placement_coordinator: "/cpc/verification",
  delivery_head: "/delivery-head/pif-approvals",
  central_placement_coordinator: "/central/drives",
};

export function landingRouteForRole(role: AppRole): string | null {
  return LANDING_ROUTES[role] ?? null;
}
