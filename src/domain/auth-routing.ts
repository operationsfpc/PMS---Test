import type { AppRole } from "./types";

/**
 * The screen a role lands on immediately after signing in.
 *
 * One login screen serves everybody; this rule decides where they go next.
 *
 * The five read-only reporting roles share ONE dashboard. RLS already scopes
 * what each can read, so a Campus Manager simply sees fewer rows than a CEO.
 * Five separate screens would be five chances to compute "placed" differently.
 */
const LANDING_ROUTES: Record<AppRole, string> = {
  admin: "/admin/campuses",
  student: "/student",
  campus_placement_coordinator: "/cpc/verification",
  account_executive: "/ae/pif",
  delivery_head: "/delivery-head/pif-approvals",
  central_placement_coordinator: "/central/drives",
  campus_manager: "/dashboard",
  key_account_manager: "/dashboard",
  enterprise_relations: "/dashboard",
  er_head: "/dashboard",
  ceo: "/dashboard",
};

export function landingRouteForRole(role: AppRole): string {
  return LANDING_ROUTES[role];
}
