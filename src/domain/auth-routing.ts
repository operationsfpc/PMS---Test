import type { AppRole, ParticipationStatus, SrfStatus } from "./types";

/**
 * The screen a role lands on immediately after signing in.
 *
 * One login screen serves everybody; this rule decides where they go next.
 *
 * SPEC CHANGE 2026-08-17 (Karthik): "Overview can be the top item and Placement
 * Overview can be the standard landing page. Only exception is students logging
 * in for the first time."
 *
 * Every staff role used to land on its own work queue, so the app opened on
 * "what is waiting for me?" before anyone could ask "how are we doing?". The
 * overview is now the front door and the queue is one click inside it. One
 * dashboard serves them all - RLS scopes what each can read, so a Campus
 * Manager sees fewer rows than a CEO, and building one screen per role would
 * be one more chance to compute "placed" differently.
 *
 * Two roles are exceptions, both for a reason rather than a preference:
 *
 *  - `student` keeps their own dashboard. A placement overview is not their
 *    screen, and a first-time student goes to the registration form instead -
 *    see `studentLandingRoute`, which their role alone cannot answer.
 *  - `account_executive` has NO read policy on students, so the placement
 *    overview renders zeroes for them and reads as a broken account. That is
 *    also why they have no Overview entry in the sidebar. Their drives are
 *    their overview.
 */
const LANDING_ROUTES: Record<AppRole, string> = {
  admin: "/dashboard",
  student: "/student",
  campus_placement_coordinator: "/dashboard",
  account_executive: "/my-drives",
  delivery_head: "/dashboard",
  central_placement_coordinator: "/dashboard",
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
