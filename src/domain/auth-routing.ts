import type { AppRole, ParticipationStatus, SrfStatus } from "./types";

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

/**
 * Where a student lands, which their role alone cannot answer.
 *
 * Asked for 2026-08-06: "when a student logs in for the first time, he should
 * directly land on the registration page." Every student landed on the
 * dashboard — which, for one who has not registered, is a near-empty screen
 * whose only useful content is a link to the form they were meant to be
 * filling in. Making them find it is a step that exists for no reason, and
 * every student passes through this state exactly once.
 *
 * THE PRECEDENCE IS DELIBERATELY THE SAME AS `studentPrompt()`: participation
 * is settled before registration is asked for. If these two ever disagreed, an
 * opted-out student would be dropped onto a registration form while their own
 * dashboard told them never to fill one in. Change both together, or neither.
 */
export function studentLandingRoute(student: {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
}): string {
  // Settled first. An opted-out student cannot reverse the decision, so a form
  // is the last thing to put in front of them; a disbarred one cannot act on
  // it either. Both need the dashboard, which explains their standing.
  if (student.participationStatus !== "active") return LANDING_ROUTES.student;

  // The one the request is about: nothing has been submitted, so the form IS
  // their screen. It stays their landing page every login until it is sent,
  // because until then they are still "first time".
  if (student.srfStatus === "invited" || student.srfStatus === "registered") {
    return "/srf";
  }

  // ⚠️ ASSUMPTION - UNCONFIRMED (A32). A returned form is not a first login,
  // and the dashboard is the only screen that says WHY it came back. Landing
  // straight on the form would hide the coordinator's reason.
  return LANDING_ROUTES.student;
}
